#!/usr/bin/env node
const chalk = require('chalk')
const yargs = require('yargs')
const index = require('./index.js');
const fetchProcessingData = require('./fetchProcessingData.js');

yargs
  .usage('$0 <cmd> [args]')
  .command('clean', 'clean the testing environment', index.cleanEnv)
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
  .command('replay <strategy>', 'replay the available transactions on the USC', (yargs) => {
    yargs
      .positional('strategy', {
        type: 'string',
        describe: 'replay strategy (txHash, all)',
        example: 'all'
      })
  }, (argv) => {
    index.replay(argv.strategy)
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