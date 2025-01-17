const { spawnSync } = require("child_process");

/**
* Spawns a new Hardhat compilation process
* @param {String} [hardhatConfigPath=null] - the path to the hardhat configuration file to be used (specifies the artifacts directory path)
* @returns the compilation process status
*/
function spawnCompile(hardhatConfigPath = null) {
  console.log("** Compilation started: using: " + (hardhatConfigPath === null ? "hardhat" : hardhatConfigPath));
  
  var compileChild;
  const packageManagerCmd = (process.platform === "win32") ? "npx.cmd" : "npx";
  if (hardhatConfigPath === null) {
    compileChild = spawnSync(packageManagerCmd, [" hardhat clean && " + packageManagerCmd + " hardhat compile --force"], { stdio: "inherit", shell: true });
  }
  else {
    const command1 = packageManagerCmd + " hardhat --config " + hardhatConfigPath + " clean";
    const command2 = "&& " + packageManagerCmd + " hardhat --config " + hardhatConfigPath + " compile --force";
    compileChild = spawnSync(command1, command2.split(" "), { stdio: "inherit", shell: true });
  }
  
  return compileChild.status;
}


/**
* Spawns a new test process with Harhdat on the forked network
* @param {Object} txData - the data of the transaction to be replayed
*/
function spawnTest(txData) {
  var testChild;
  if (process.platform === "win32") {
    testChild = spawnSync("npm.cmd", ["--transaction=" + JSON.stringify(txData), "run-script", "test"], { stdio: "inherit" });
  } else if (process.platform === "linux" || process.platform === "darwin") {
    testChild = spawnSync("npm", ["--transaction=" + JSON.stringify(txData), "run-script", "test"], { stdio: "inherit" });
  }
  return testChild.status;
}

module.exports = {
  spawnCompile: spawnCompile,
  spawnTest: spawnTest,
};
