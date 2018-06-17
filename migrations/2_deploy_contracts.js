var Remittance = artifacts.require("./Remittance.sol");

module.exports = function(deployer, network, accounts) {
    let owner = accounts[1];
    const ownerCommission = web3.toBigNumber(web3.toWei(0.15, 'ether'));
    const maxBlockDuration = 240;
    const gasLimit = 2000000;

    if (network == "ropsten") {
        owner = ""; // TODO: fill
    }

    deployer.deploy(Remittance, ownerCommission, maxBlockDuration,
        { from: owner, gas: gasLimit });
};
