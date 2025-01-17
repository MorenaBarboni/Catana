//External modules
const assert = require('assert');
const chalk = require('chalk');
const { ethers } = require('hardhat');
const helpers = require("@nomicfoundation/hardhat-toolbox/network-helpers");
//Catana modules
const fetch = require('../fetchProcessingData');
const logger = require('../logger');
const decoder = require("../decoder")
const validator = require("../validator")

//Catana configuration
const catanaConfig = require('../catana-config');
const jsonRpcUrl = "https://mainnet.infura.io/v3/" + catanaConfig.INFURA_KEY;

describe("Replay Test\n", () => {

    let tx; //data of transaction to be replayed
    let proxyName, logicName; //contract names
    let proxyABI, deployedLogicABI, upgradedLogicABI; //contract ABIs
    let upgradedLogicBytecode; //upgraded logic bytecode
    let deployedLogicPath; // path to the deployed logic contract sources
    let storageLayoutV1WithValues, storageLayoutV2WithValues;
    let txOutcomeOnLogicV1, txOutcomeOnLogicV2;
    let decodedTxData;
    let sVarmappingElements;
    let replayTxStartTime = Date.now();


    // Before running the tests
    before(async () => {
        //Parse the transaction to be replayed from npm config
        tx = JSON.parse(process.env.npm_config_transaction);

        //Proxy and Logic contract names
        proxyName = fetch.getFileName(catanaConfig.ProxyPath);
        logicName = fetch.getFileName(catanaConfig.UpgradedLogicPath);

        //Path to the deployed logic contract sources
        deployedLogicPath = fetch.getDeployedContractSourcePath(catanaConfig.UpgradedLogicPath);

        //Extract contract ABI
        proxyABI = await fetch.getABI(catanaConfig.ProxyPath, proxyName)
        deployedLogicABI = await fetch.getABI(deployedLogicPath, logicName)
        upgradedLogicABI = await fetch.getABI(catanaConfig.UpgradedLogicPath, logicName)
        //Extract bytecode of upgraded logic contract
        upgradedLogicBytecode = await fetch.getBytecode(catanaConfig.UpgradedLogicPath, logicName)
    });

    //Replays the tx on LogicV1, storing its outcome and storage variables
    it("Should successfully replay the tx on the Deployed Logic contract (V1)", async () => {
        console.log(chalk.yellow.bold("\nReplaying tx on Deployed Logic Contract (" + logicName + " V1) ..."));

        try {
            //Fork at tx.blocknumber-1
            await helpers.reset(jsonRpcUrl, parseInt(tx.blockNumber) - 1);

            const blockNumber = await ethers.provider.getBlockNumber();
            assert.equal(blockNumber, parseInt(tx.blockNumber) - 1, 'Fork should be at the right blocknumber');
            console.log("- Mainnet forked @block: " + blockNumber)

            //Retrieve the Proxy contract from the current fork
            let proxy = await ethers.getContractAt(proxyABI, catanaConfig.DeployedProxyAddr);
            const proxyAddr = await proxy.getAddress();
            assert.equal(proxyAddr, catanaConfig.DeployedProxyAddr, 'Proxy address should be correct');
            console.log("- " + chalk.magenta("Deployed Proxy") + " address is: " + chalk.magenta(proxyAddr))

            //Retrieve deployed Logic contract (V1) from the current fork
            let logicV1 = await ethers.getContractAt(deployedLogicABI, catanaConfig.DeployedLogicAddr);
            const logicV1Addr = await logicV1.getAddress();
            assert.equal(logicV1Addr, catanaConfig.DeployedLogicAddr, 'LogicV1 address should be correct');
            console.log("- " + chalk.blue("Deployed Logic") + " address is: " + chalk.blue(logicV1Addr))

            //Send funds to the sender (tx.from) and retrieve the signer object used to sign and send transactions on the network
            await network.provider.send("hardhat_setBalance", [tx.from, "0x10000000000000000000"]);
            const signer = await ethers.getSigner(tx.from)
            assert.equal(signer.address.toLowerCase(), tx.from.toLowerCase(), 'signer should be equal to tx.from');
            console.log("- Tx signer is: " + signer.address)

            //Get Proxied Logic contract and connect the signer
            const proxiedV1 = logicV1.attach(catanaConfig.DeployedProxyAddr).connect(signer);

            // Impersonate the sender's account
            await network.provider.request({ method: "hardhat_impersonateAccount", params: [tx.from] });

            //Decode tx input 
            const contractInterface = new ethers.Interface(upgradedLogicABI);
            decodedTxData = contractInterface.parseTransaction({ data: tx.input });
        	let decodedTxArgs = customDeepClone(decodedTxData.args);

            //Replay staticCall and transaction on Deployed contract (V1) and save its outcome
            try {
            	txOutcomeOnLogicV1 = await proxiedV1[tx.functionName].staticCall(...decodedTxArgs, { value: tx.value, gasLimit: 2100000 })
            	await proxiedV1[tx.functionName](...decodedTxArgs, { value: tx.value, gasLimit: 2100000 });
            } catch (error) {
                //The transaction reverted - might still be a valid outcome
                if (error.toString().includes("VM Exception while processing transaction: revert")) {
                    const errorMessage = error.toString();
                    txOutcomeOnLogicV1 = "revert: " + errorMessage;
                }
                //The transaction could not be replayed on the original contract
                else {
                    replayTxDuration = Date.now() - replayTxStartTime;
                    logger.logReplayResultToJson(tx, decodedTxData, null, null, "error/timedout", 2, replayTxDuration);
                    console.log(error)
                    process.exit(2)
                }
            }
            await network.provider.request({ method: "hardhat_stopImpersonatingAccount", params: [tx.from] });
            console.log("- Tx successfully replayed on Deployed Logic Contract: " + logicName);

            //Save values of storage variables after the transaction execution
            const logicV1SourcePath = fetch.getDeployedContractSourcePath(catanaConfig.UpgradedLogicPath);
            const storageLayoutV1 = decoder.getStorageLayoutBySource(logicV1SourcePath);
            storageLayoutV1WithValues = await Promise.all(storageLayoutV1.map(async sVar => {
                sVar = extractStorageVarValue(proxy.target, sVar);
                return sVar;
            }));
            console.log("- Scraping mapping slots from Etherscan");
            sVarmappingElements = await decoder.getChangedMappingSlots(storageLayoutV1WithValues, tx.hash, proxyAddr)
            if (sVarmappingElements !== null && sVarmappingElements !== undefined) {
                const mappingSvarV1WithValues = await extractStorageVarValue(proxy.target, sVarmappingElements);
                storageLayoutV1WithValues.push(mappingSvarV1WithValues);
            }
        } catch (error) {
            replayTxDuration = Date.now() - replayTxStartTime;
            logger.logReplayResultToJson(tx, decodedTxData, null, null, "error/timedout", 2, replayTxDuration);
            console.log(error)
            process.exit(2)
        }
    });

    //Replays the tx on LogicV2, storing its outcome and storage variables
    it("Should successfully replay the tx on the upgraded Logic Contract (V2)", async () => {

        // ---- UPGRADE DEPLOYED CONTRACT  ----

        console.log(chalk.yellow.bold("\nUpgrading Deployed Logic Contract (" + logicName + " V1)"));

        try {
            //Reset network 1 block back
            await helpers.reset(jsonRpcUrl, parseInt(tx.blockNumber) - 1);
            assert.equal(await ethers.provider.getBlockNumber(), parseInt(tx.blockNumber) - 1, 'Fork should be at the right blocknumber');
            console.log("- Mainnet forked @block: " + await ethers.provider.getBlockNumber());

            //Retrieve the Proxy contract from the current fork
            let proxy = await ethers.getContractAt(proxyABI, catanaConfig.DeployedProxyAddr);
            const proxyAddr = await proxy.getAddress();
            assert.equal(proxyAddr, catanaConfig.DeployedProxyAddr, 'Proxy address should be correct');

            const deployedBytecode = await network.provider.send("eth_getCode", [catanaConfig.DeployedLogicAddr]);
        	console.log("- " + chalk.blue("Deployed Logic") + " bytecode is	: " + deployedBytecode.substring(0, 20) + "..." + deployedBytecode.substring(deployedBytecode.length - 10, deployedBytecode.length));
            console.log("- " + chalk.blue("Deployed Logic") + " bytecode set to: " + upgradedLogicBytecode.substring(0, 20) + "..." + upgradedLogicBytecode.substring(upgradedLogicBytecode.length - 10, upgradedLogicBytecode.length));
            await helpers.setCode(catanaConfig.DeployedLogicAddr, upgradedLogicBytecode);
            const upgradedBytecode = await network.provider.send("eth_getCode", [catanaConfig.DeployedLogicAddr]);
            console.log("- " + chalk.green("Upgraded Logic") + " bytecode is now: " + upgradedBytecode.substring(0, 20) + "..." + upgradedBytecode.substring(upgradedBytecode.length - 10, upgradedBytecode.length));

            // ---- REPLAY TX ON UPGRADED LOGIC ----
            let logicV2 = await ethers.getContractAt(deployedLogicABI, catanaConfig.DeployedLogicAddr);
            console.log(chalk.yellow.bold("\nReplay tx on Upgraded Logic Contract (" + logicName + " V2) ..."));

            //Send funds to the sender (tx.from) and retrieve the signer object used to sign and send transactions on the network
            await network.provider.send("hardhat_setBalance", [tx.from, "0x10000000000000000000"]);
            const signer = await ethers.getSigner(tx.from)
            assert.equal(signer.address.toLowerCase(), tx.from.toLowerCase(), 'signer should be equal to tx.from');
            console.log("- Tx signer is: " + signer.address)

            // Impersonate the sender's account
            await network.provider.request({ method: "hardhat_impersonateAccount", params: [tx.from] });

            //Replay transaction on Proxied Logic contract
            const proxiedV2 = logicV2.attach(catanaConfig.DeployedProxyAddr).connect(signer);

            //Decode tx input
            const contractInterface = new ethers.Interface(deployedLogicABI);
            const decodedTxData = contractInterface.parseTransaction({ data: tx.input });
        	let decodedTxArgs = customDeepClone(decodedTxData.args);

            try {
            	txOutcomeOnLogicV2 = await proxiedV2[tx.functionName].staticCall(...decodedTxArgs, { value: tx.value, gasLimit: 2100000 })
            	await proxiedV2[tx.functionName](...decodedTxArgs, { value: tx.value, gasLimit: 2100000 });
            } catch (error) {
                //The transaction reverted - might still be a valid outcome
                if (error.toString().includes("VM Exception while processing transaction: revert")) {
                    const errorMessage = error.toString();
                    txOutcomeOnLogicV2 = "revert: " + errorMessage;
                }
                //The transaction could not be replayed on the upgraded contract
                else {
                    replayTxDuration = Date.now() - replayTxStartTime;
                    logger.logReplayResultToJson(tx, decodedTxData, null, null, "error/timedout", 3, replayTxDuration);
                    console.log(error)
                    process.exit(3)
                }
            }
            await network.provider.request({ method: "hardhat_stopImpersonatingAccount", params: [tx.from] });
            console.log("- Tx successfully replayed on LogicV2");

            let storageLayoutV2 = decoder.getStorageLayoutBySource(catanaConfig.UpgradedLogicPath);
            storageLayoutV2WithValues = await Promise.all(storageLayoutV2.map(async sVar => {
                sVar = extractStorageVarValue(proxy.target, sVar)
                return sVar;
            }));
            //Get mapping element values
            if (sVarmappingElements !== null && sVarmappingElements !== undefined) {
                const mappingSvarV2WithValues = await extractStorageVarValue(proxy.target, sVarmappingElements);
                storageLayoutV2WithValues.push(mappingSvarV2WithValues);
            }
        } catch (error) {
            replayTxDuration = Date.now() - replayTxStartTime;
            logger.logReplayResultToJson(tx, decodedTxData, null, null, "error/timedout", 3, replayTxDuration);
            console.log(error)
            process.exit(3)
        }
    });

    it("Should not find outcome changes", async () => {
        console.log(chalk.yellow.bold("\nAnalyzing outcome changes"));
        if (txOutcomeOnLogicV1 === undefined || txOutcomeOnLogicV2 === undefined || storageLayoutV1WithValues === undefined || storageLayoutV2WithValues === undefined) {
            replayTxDuration = Date.now() - replayTxStartTime;
            logger.logReplayResultToJson(tx, decodedTxData, null, null, "error", 4, replayTxDuration);
            process.exit(4)
        } else {
            storageLayoutV1WithValues = decoder.decodeStorageValues(storageLayoutV1WithValues);
            storageLayoutV2WithValues = decoder.decodeStorageValues(storageLayoutV2WithValues);

            const outcome = validator.computeOutcome(txOutcomeOnLogicV1, txOutcomeOnLogicV2)
            const storageChanges = validator.computeStorageChanges(storageLayoutV1WithValues, storageLayoutV2WithValues)
            const testResult = validator.getReplayTestingResult(outcome, storageChanges);
            replayTxDuration = Date.now() - replayTxStartTime;
            logger.logResultToJson(tx, mutantHash, decodedTxData, outcome, storageChanges, testResult, testResult === true ? 0 : 1, replayTxDuration);
            assert(testResult, "Transaction outcome changed:\n " + JSON.stringify(outcome, null, 2));
        }
    });
});

/**
* Given a state variable data, it recursively extracts its value from the storage
* @param {String} proxyTarget the contract to read storage from
* @param {Object} sVarData the state variable data
* @returns the state variable data with its value
*/
async function extractStorageVarValue(proxyTarget, sVarData) {

    //Do not affect input sVar object
    let sVar = { ...sVarData };

    //Retrieve the value of those variables that are always stored in a single slot
    //If svar already has a value property, it has been already set during the previous recursion
    if (!sVar.hasOwnProperty('value')) {
        let value = await getValueFromSlot(proxyTarget, sVar.slot);
        sVar.value = value;
    }

    //For now, we only extract the value in the initial mapping slot
    if (/(t_mapping)/.test(sVar.type)) {
        let value = await getValueFromSlot(proxyTarget, sVar.slot);
        sVar.value = value;
    }

    //Custom type for mapping slots
    if (/(t_custom_mapping_elements)/.test(sVar.type)) {

        updatedValue = {}
        const slots = Object.keys(sVar.value)

        for (const slot of slots) {
            let value = await getValueFromSlot(proxyTarget, slot);
            updatedValue[slot] = value;
        }
        sVar.value = updatedValue;
    }


    //Retrieve the value of those variables that may be stored in mutliple slots
    if (/(t_array|t_struct|t_bytes|t_string)/.test(sVar.type)) {

        let sVarSlots;

        //Extract storage slots of each array element
        if (sVar.type.startsWith("t_array")) {
            const arrayMutability = decoder.getArrayMutability(sVar.type);
            const arrayType = decoder.getArrayType(sVar.type);

            //Extract slots where the fixed/dynamic array elements are stored
            if (arrayMutability === "fixed") {
                sVarSlots = decoder.extractFixedArrayElementSlots(sVar);
                sVar.numberOfElements = decoder.getFixedArrayLength(sVar.type);
            }
            else if (arrayMutability === "dynamic") {
                sVarSlots = decoder.extractDynamicArrayElementSlots(sVar);
                sVar.numberOfElements = decoder.getDynamicArrayLength(sVar.value);
            }

            //Retrieve values saved at the slots
            sVar.value = await getValueFromSlots(proxyTarget, sVarSlots);

            //Extract values of nested arrays
            if (arrayType.startsWith("t_array")) {

                //Starting slots of each internal array
                const internalArraySlots = Object.keys(sVar.value);
                let internalArraysVars = {};

                for (let i = 0; i < internalArraySlots.length; i++) {
                    //Create new array variable
                    const arrayStartingSlot = internalArraySlots[i];

                    let sVarInternalArray = {};
                    sVarInternalArray.type = arrayType;
                    sVarInternalArray.slot = arrayStartingSlot;
                    sVarInternalArray.value = sVar.value[arrayStartingSlot];
                    sVarInternalArray = await extractStorageVarValue(proxyTarget, sVarInternalArray);
                    internalArraysVars[i] = sVarInternalArray;
                }
                sVar.value = internalArraysVars;
            }
        }
        else if (sVar.type.startsWith("t_struct")) {
            sVarSlots = decoder.extractStructAttributeSlots(sVar);
            sVar.value = await getValueFromSlots(proxyTarget, sVarSlots);
        }
        else if (sVar.type.startsWith("t_bytes")) {
            sVarSlots = decoder.extractBytesArrayElementSlots(sVar);
            sVar.value = await getValueFromSlots(proxyTarget, sVarSlots);
        }
        //Strings are encoded like t_bytes
        else if (sVar.type.startsWith("t_string")) {
            sVarSlots = decoder.extractBytesArrayElementSlots(sVar);
            sVar.value = await getValueFromSlots(proxyTarget, sVarSlots);
        }
        else {
            sVar.value = await getValueFromSlot(proxyTarget, sVar.slot);
        }
    }
    return sVar;
}


/**
* Given a list of storage slots, it extracts their value from storage and returns them as slot-value object 
* @param {String} proxyTarget the contract to read storage from
* @param {Object} varType - the type of the state variable to be processed
* @param {Array} varSlots - the list of slots where the variable values are stored
* @returns sVarValue - an object containg the slot-value pairs for the variable
*/
async function getValueFromSlots(proxyTarget, varSlots) {
    let varValue = {};
    const promises = varSlots.map(async varSlot => {
        const value = await getValueFromSlot(proxyTarget, varSlot);
        varValue[varSlot] = value;
    });
    await Promise.all(promises);
    return varValue;
}

/**
* Given a single storage slot, it extracts its value from storage
* @param {String} proxyTarget the contract to read storage from
* @param {String} slot - the storage slot
* @returns sVarValue - a string representing the value storead at the given slot
*/
async function getValueFromSlot(proxyTarget, slot) {
    let parsedSlot = decoder.parseSlot(slot);
    return await helpers.getStorageAt(proxyTarget, parsedSlot);
}

function customDeepClone(value) {
	if (Array.isArray(value)) {
    	// If it's an array, recursively deep clone each element
    	return value.map(customDeepClone);
	} else if (value !== null && typeof value === 'object' && value.constructor === Object) {
    	// If it's a plain object, recursively deep clone each property
    	return Object.keys(value).reduce((acc, key) => {
        	acc[key] = customDeepClone(value[key]);
        	return acc;
    	}, {});
	}
	// If it's an instance of a class like Ethers.js Result, just return it as is (no cloning)
	return value;
}