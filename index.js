//External modules
require('hardhat')
const fs = require('fs')
const chalk = require('chalk')
const path = require('path')
//Catana modules
const fetch = require('./fetchProcessingData');
const logger = require('./logger');
const testingInterface = require('./testInterface')
//Catana configuration
const catanaConfig = require('./catana-config');

/**
* Performs the required setup operations before starting the replay testing process
* @param {Function} callback - Callback function to be executed once the setup is completed
*/
async function setup(callback) {
    console.log(chalk.yellow("Setting up testing environment..."))

    const { catanaDir, ProxyPath, UpgradedLogicPath, DeployedLogicAddr, DeployedProxyAddr, DeployedSourcesDir, UpgradedSourcesDir } = catanaConfig;

    //Check configuration
    if (catanaDir === "" || ProxyPath === "" || UpgradedLogicPath === "" || DeployedLogicAddr === "" ||
        DeployedProxyAddr === "" || DeployedSourcesDir === "" || UpgradedSourcesDir === "") {
        throw new Error("Catana configuration incomplete.")
    }

    const proxyName = fetch.getFileName(ProxyPath);
    const logicName = fetch.getFileName(UpgradedLogicPath);
    const deployedLogicPath = fetch.getDeployedContractSourcePath(catanaConfig.UpgradedLogicPath);

    //Download sources of deployed logic contracts
    if (!fs.existsSync(DeployedSourcesDir)) { fs.mkdirSync(DeployedSourcesDir, { recursive: true }); }
    if (!fs.existsSync(deployedLogicPath) || !fs.existsSync(ProxyPath)) {
        fetch.cleanDir(DeployedSourcesDir);
        console.log("Retrieving sources for Deployed Logic: " + logicName + " @ " + DeployedLogicAddr)
        await fetch.fetchContractSourcesByAddress(DeployedLogicAddr, DeployedSourcesDir);
        console.log("Retrieving sources for Deployed Proxy: " + proxyName + " @ " + DeployedProxyAddr)
        await fetch.fetchContractSourcesByAddress(DeployedProxyAddr, DeployedSourcesDir);
    } else {
        console.log("Sources already available locally")
    }

    //Clean previous build-info
    fetch.cleanDir("./artifacts");

    //Create log dir and setup reports
    if (!fs.existsSync(catanaConfig.catanaDir)) { fs.mkdirSync(catanaConfig.catanaDir); }
    callback();
}

/**
* Replay all transactions @ catanaConfig.transactionsPath on the deployed and upgraded SUT.  
* If a transaction hash is specified, only that transaction will be replayed.
* @param {string} strategy - the replay strategy (txHash, all)
* @param {String} [txHash=null]  - the hash of the transaction to be replayed (optional)
*/
async function replay(strategy) {

    logger.setupCatanaReports();

    let transactions = [];

    if (strategy.startsWith("0x")) {
        const txSamplePath = catanaConfig.transactionsPath;
        const txHash = strategy;
        const transaction = fetch.getTransaction(txHash, txSamplePath);
        transactions.push(transaction);
        console.log(chalk.bold.yellow(`> Replay transaction ${txHash}`));
        setup(async () =>
            await runTest(transactions)
        );
    }
    //Replay the entire window
    else if (strategy === "all") {
        const txSamplePath = catanaConfig.transactionsPath;
        transactions = fetch.getAllTransactions(txSamplePath);
        console.log(chalk.bold.yellow(`> Replay all transactions in ${txSamplePath}`));
    }

    setup(async () => await runTest(transactions));
}

/**
* Run replay tests with a list of transactions belonging to a certain strategy
* @param {String} strategyID - the ID of the replay strategy (e.g.: one, all, random-3, frequency-1)
* @param {Array} transactions - the list of transactions to be replayed
*/
async function runTest(transactions) {
    for (let i = 0; i < transactions.length; i++) {
        const tx = transactions[i];

        const status = testingInterface.spawnTest(tx, null);
        const txData = logger.readDataFromJson(tx.hash, "tx");
        const outcomeChanges = logger.readDataFromJson(tx.hash, "outcomeChanges");
        const storageChanges = logger.readDataFromJson(tx.hash, "storageChanges");
        const duration = logger.readDataFromJson(tx.hash, "duration");

        logger.logReplayResultToCsv(tx, txData, outcomeChanges, storageChanges, status, duration);

        if (status === 0) {
            console.info(chalk.green("Replay testing session for " + tx.hash + " passed in ", duration));
        } else if (status === 1) {
            console.error(chalk.red("Replay testing session for " + tx.hash + " failed in ", duration));
        }
    }
    console.log(chalk.bold.yellow('> Done 👋'));
}

/**
* Clean the testing environment (fetched sources, hardhat artifacts, cache)
*/
function cleanEnv() {
    fetch.cleanDir("./artifacts");
    fetch.cleanDir("./cache");
    fetch.deleteDir(catanaConfig.DeployedSourcesDir);
}

module.exports = {
    cleanEnv: cleanEnv,
    replay: replay
};