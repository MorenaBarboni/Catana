const { artifacts } = require('hardhat');
const catanaConfig = require('./catana-config');
const chalk = require('chalk');
const etherscan = require('etherscan-api').init(catanaConfig.ETHERSCAN_KEY);
const fs = require('fs');
const fsExtra = require('fs-extra');
const path = require('path');

/**
* Fetch the source code of a deployed contract by its address from Etherscan.
* Saves the source code of each contract source to a specified path.
* @param {String} contractAddress the address of the contract to be retrieved
* @param {String} contractDir the directory where the source files must be saved (e.g.: ./contracts_V1)
* 
* @returns contractDir - the local path of the directory where the source codes are stored 
*/
async function fetchContractSourcesByAddress(contractAddress, contractDir) {

	let result = (await etherscan.contract.getsourcecode(contractAddress)).result[0];
	let fetchedSourceCode = result.SourceCode;

	if (fetchedSourceCode === "") {
		throw new Error(chalk.red("Source code for contract deployed @" + contractAddress + " not available."))
	} else {
		if (fetchedSourceCode.startsWith("{{")) {
			let sources = JSON.parse((fetchedSourceCode.substring(1, fetchedSourceCode.length - 1))).sources;
			for (let sourceKey in sources) {
				//console.log(sourceKey + ": " + sources[sourceKey]);
				const sourceCode = sources[sourceKey].content;
				//Libraries (e.g.: @openzeppelin) should be saved in the root directory
				let savePath = sourceKey.startsWith("contracts/") ? sourceKey.replace("contracts/", contractDir + "/") : sourceKey;
				writeSources(savePath, sourceCode);
			}
		}
		//If SourceCode is not an object, it contains a single source
		else {
			const sourceCodeFilePath = path.join(__dirname, contractDir, result.ContractName + ".sol");

			fs.writeFileSync(sourceCodeFilePath, fetchedSourceCode, 'utf-8');
		}
		return contractDir;
	}

}

/**
 * Retrieves all the transactions executed on the Proxy from Mainnet, and save them into the catana/transactions.json.
 * @param {Number} size the maximum number of transactions to be retrieved
 * @param {Number} startBlock - the startblock from which to extract transactions (1 by default)
 * 
 */
async function captureProxyTxs(size, startBlock = 1) {
	let filteredTx = []
	let txs = await etherscan.account.txlist(catanaConfig.DeployedProxyAddr, startBlock, 99999999, 1, 10000, 'desc');
	let txList = txs.result;

	txList.forEach(tx => {
		if (tx.isError === '0' && filteredTx.length < size) {
			filteredTx.push(tx);
		}
	});
	if (filteredTx.length < size) {
		console.log(chalk.yellow("Warning: The Proxy features " + filteredTx.length + " valid transactions"));
	}

	var JSONTX = JSON.stringify(filteredTx)
	fs.writeFileSync(catanaConfig.transactionsPath, JSONTX);

	console.log("> Transactions saved to :" + catanaConfig.transactionsPath);
}

/**
* Parses a transaction file from a specified path and returns it  
* @param {String} [txPath=null]  - the path to the transaction's json (catanaConfig.transactionPath if null)
* @returns filteredTx - a list of non-reverting transactions
*/
function getAllTransactions(txPath = null) {

	const transactionsPath = txPath === null ? catanaConfig.transactionsPath : txPath;

	if (!fs.existsSync(transactionsPath)) { throw new Error(transactionsPath + " does not exist") }

	return JSON.parse(fs.readFileSync(transactionsPath));
}

/**
* Get a transaction by hash from the json at a specified path
* @param {String} txHash - the transaction hash
* @param {String} [txPath=null]  - the path to the transaction's json (catanaConfig.transactionPath if null)
* @returns the transaction object
*/
function getTransaction(txHash, txPath = null) {

	const transactionsPath = txPath === null ? catanaConfig.transactionsPath : txPath;
	if (!fs.existsSync(transactionsPath)) { throw new Error(transactionsPath + " does not exist") }

	let jsonTx = JSON.parse(fs.readFileSync(transactionsPath));

	const tx = jsonTx.filter(transaction => transaction.hash === txHash)[0];
	if (!tx || tx.isError === '1') {
		throw new Error(chalk.red("> Hash \"" + txHash + "\" does not correspond to a valid transaction."));
	}
	return tx;
}

/**
 * Extracts the data from the file(s) in the build-info folder generated by hardhat
 * @param {String} [artifactsDirPath="artifacts"] - the path to the hardhat directory that contains the compiled artifacts (artifacts by default)
 * @returns a json in the format: {'buildInfoFile1.json': {...},  'buildInfoFile2.json': {...}}
 */
function readBuildInfoFiles(artifactsDirPath = "artifacts") {
	const buildInfoFolder = path.join(__dirname, artifactsDirPath, 'build-info');
	try {
		const files = fs.readdirSync(buildInfoFolder);

		const buildInfoFiles = files.filter((file) => {
			return file.endsWith('.json');
		});

		const buildInfoData = {};

		buildInfoFiles.forEach((file) => {
			const filePath = path.join(buildInfoFolder, file);
			const fileData = fs.readFileSync(filePath, 'utf8');
			buildInfoData[file] = JSON.parse(fileData);
		});

		return buildInfoData;
	} catch (err) {
		throw new Error(err);
	}
}

/**
* Writes content to a file at the specified path, creating directories recursively if necessary.
* @param {string} filePath - The path to the file to be written.
* @param {string} fileContent - The content to be written to the file.
* @throws {Error} Throws an error if unable to create directories or write to the file.
*/
function writeSources(filePath, fileContent) {
	// Create directory recursively
	const directoryPath = path.dirname(filePath);
	try {
		fs.mkdirSync(directoryPath, { recursive: true });
	} catch (err) {
		if (err.code !== 'EEXIST') {
			throw err;
		}
	}
	fs.writeFileSync(filePath, fileContent);
}

/**
* Extracts the name of the contract from its sourcePath
* @param {string} sourcePath - The source path of the smart contract (e.g.: ./contracts/Proxy.sol)
* @returns the name of the contract (e.g.: Proxy)
*/
function getFileName(sourcePath) {
	let contractName = path.basename(sourcePath);
	contractName = contractName.replace(/\.sol$/, '');
	return contractName;
}

/**
* Extracts the root Directory of a contract from its sourcePath
* @param {string} sourcePath - The source path of the smart contract (e.g.: ./contracts/Proxy.sol)
* @returns the name of the contract (e.g.: ./contracts)
*/
function getRootDir(sourcePath) {
	const rootDir = path.normalize(path.dirname(sourcePath));
	return rootDir;
}

/**
* Determine the location of the deployed contract (V1) based on the source path of its original version
* @param {string} originalSourcePath - The source path of the original smart contract (e.g.: ./contracts/Proxy.sol).
* @returns the path where the source of the deployed smart contract is saved (e.g.: ./contracts/deployed/Proxy.sol).
*/
function getDeployedContractSourcePath(originalSourcePath) {
	let rootDir = getRootDir(originalSourcePath);
	return originalSourcePath.replace(rootDir, path.normalize(catanaConfig.DeployedSourcesDir));
}

/**
* Extracts the deployed bytecode of a given contract from the specified hardhat's artifacts.
* @param {String} contractSourcePath - the source path of the smart contract
* @param {String} contractName - the name of the smart contract
* @returns the contract's deployedBytecode
*/
async function getBytecode(contractSourcePath, contractName) {
	const contractArtifact = await artifacts.readArtifact(contractSourcePath + ":" + contractName);
	return contractArtifact.deployedBytecode;
}

/**
* Extracts the ABI of a given contract from the specified hardhat's artifacts.
* @param {String} contractSourcePath - the source path of the smart contract
* @param {String} contractName - the name of the smart contract
* @returns the contract's ABI
*/
async function getABI(contractSourcePath, contractName) {
	const contractArtifact = await artifacts.readArtifact(contractSourcePath + ":" + contractName);
	return contractArtifact.abi;
}

/**
* Clean the content of a directory without deleting it
*/
function cleanDir(dirName) {
	if (fs.existsSync(dirName)) {
		fsExtra.emptyDirSync(dirName);
		console.log("Cleaning directory " + dirName);
	}
}

/**
* Delete a directory and all its content
*/
function deleteDir(dirName) {
	if (fs.existsSync(dirName)) {
		// Use fs.rmdir to remove the directory
		fs.rmdir(dirName, { recursive: true }, (err) => {
			if (err) {
				console.error('Error while deleting directory:', err);
			} else {
				console.log("Deleting directory " + dirName);
			}
		});
	}
}

module.exports = {
	cleanDir: cleanDir,
	deleteDir: deleteDir,
	getABI: getABI,
	getBytecode: getBytecode,
	fetchContractSourcesByAddress: fetchContractSourcesByAddress,
	captureProxyTxs: captureProxyTxs,
	getAllTransactions: getAllTransactions,
	getDeployedContractSourcePath: getDeployedContractSourcePath,
	getFileName: getFileName,
	getRootDir: getRootDir,
	getTransaction: getTransaction,
	readBuildInfoFiles: readBuildInfoFiles,
};
