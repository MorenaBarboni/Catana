#!/usr/bin/env node
const chalk = require('chalk')
const yargs = require('yargs')
const index = require('./index.js');
const fetchProcessingData = require('./fetchProcessingData.js');
const scraper = require('./scraper.js');

yargs
  .usage('$0 <cmd> [args]')
  .command('clean', 'clean the testing environment', index.cleanEnv)
  .command('replay <strategy>', 'replay the available transactions according to a strategy', (yargs) => {
    yargs
      .positional('strategy', {
        type: 'string',
        describe: 'replay strategy (txHash, all, random, last, user, unique or frequency)',
        example: 'all'
      })
  }, (argv) => {
    index.replay(argv.strategy)
  })
  .command('capture <nTx> [startBlock]', 'Extracts nTx executed on the proxy and saves them to catana/transactions.json', (yargs) => {
    yargs
      .positional('nTx', {
        type: 'Number',
        describe: 'the number of transactions to be extracted',
        example: '40'
      })
      .positional('startBlock', {
        type: 'Number',
        describe: 'the startBlock (optional)',
        example: '1'
      })
  }, (argv) => {
    fetchProcessingData.captureProxyTxs(argv.nTx, argv.startBlock)
  })
  .command('getLast <nTx> [txPath]', 'build a sample of the last nTx transactions', (yargs) => {
    yargs
      .positional('nTx', {
        type: 'Number',
        describe: 'the number of transactions to be extracted',
        example: '40'
      })
      .positional('txPath', {
        type: 'String',
        describe: 'the path to the transactions from which to extract the sample (optional)',
        example: './catana/transactions/transactions.json'
      })
  }, (argv) => {
    fetchProcessingData.getLastNTx(argv.nTx, argv.txPath)
  })
  .command('getRandom <nTx> [txPath]', 'build a sample of random nTx transactions', (yargs) => {
    yargs
      .positional('nTx', {
        type: 'Number',
        describe: 'the number of transactions to be extracted',
        example: '40'
      })
      .positional('txPath', {
        type: 'String',
        describe: 'the path to the transactions from which to extract the sample (optional)',
        example: './catana/transactions/transactions.json'
      })
  }, (argv) => {
    fetchProcessingData.getRandomNTx(argv.nTx, argv.txPath)
  })
  .command('getUnique <nTx> [txPath]', 'build a sample of nTx transactions for each unique method', (yargs) => {
    yargs
      .positional('nTx', {
        type: 'Number',
        describe: 'the number of transactions to be extracted for each unique method',
        example: '1'
      })
      .positional('txPath', {
        type: 'String',
        describe: 'the path to the transactions from which to extract the sample (optional)',
        example: './catana/transactions/transactions.json'
      })
  }, (argv) => {
    fetchProcessingData.getUniqueNTx(argv.nTx, argv.txPath)
  })
  .command('getFrequency <nTx> [txPath]', 'build a sample of nTx transactions proportional to method frequency', (yargs) => {
    yargs
      .positional('nTx', {
        type: 'Number',
        describe: 'the number of transactions to be extracted per user',
        example: '5'
      })
      .positional('txPath', {
        type: 'String',
        describe: 'the path to the transactions from which to extract the sample (optional)',
        example: './catana/transactions/transactions.json'
      })
  }, (argv) => {
    fetchProcessingData.getFrequencyNTx(argv.nTx, argv.txPath)
  })
  .command('scrape <txHash>', 'Scrape State Diff caused by a transaction from Etherscan', (yargs) => {
    yargs
      .positional('txHash', {
        type: 'string',
        describe: 'transaction hash',
        example: '0x123...'
      })
  }, (argv) => {
    scraper.scrapePage(argv.txHash)
  })
  .help()
  .alias('h', 'help')
  .demandCommand(1, 'You must specify a command.')
  .strict()
  .fail((msg, err, yargs) => {
    if (msg) console.error(chalk.red(msg));
    if (err) console.error(err);
    yargs.showHelp();
    process.exit(1);
  })
  .argv;