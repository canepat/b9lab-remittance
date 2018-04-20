var Remittance = artifacts.require("./Remittance.sol");

module.exports = function(deployer, network, accounts) {
    let owner = accounts[1];
    const remittancePercentage = 2;
    const maxBlockDuration = 240;
    const gasLimit = 2000000;

    if (network == "ropsten") {
        owner = ""; // TODO: fill
    }

    deployer.deploy(Remittance, remittancePercentage, maxBlockDuration,
        { from: owner, gas: gasLimit });
};
