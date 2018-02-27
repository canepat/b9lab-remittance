"use strict";

// Import the third-party libraries
let Promise = require("bluebird");
Promise.retry = require("bluebird-retry");

// Import the local libraries and customize the web3 environment
const addEvmFunctions = require("../utils/evmFunctions.js");
const addMinerFunctions = require("../utils/minerFunctions.js");

addEvmFunctions(web3);
addMinerFunctions(web3);

if (typeof web3.eth.getBlockPromise !== "function") {
    Promise.promisifyAll(web3.eth, { suffix: "Promise" });
}
if (typeof web3.evm.increaseTimePromise !== "function") {
    Promise.promisifyAll(web3.evm, { suffix: "Promise" });
}
if (typeof web3.miner.startPromise !== "function") {
    Promise.promisifyAll(web3.miner, { suffix: "Promise" });
}
if (typeof web3.version.getNodePromise !== "function") {
    Promise.promisifyAll(web3.version, { suffix: "Promise" });
}

module.exports = function getPastBlock(blockNumber) {
    return web3.version.getNodePromise()
        .then(node => node.indexOf("EthereumJS TestRPC") >= 0)
        .then(isTestRPC => {
            // Wait for node to have mined a block after the requested one
            return Promise.retry(() => web3.eth.getBlockPromise("latest")
                .then(block => {
                    if (block.number <= blockNumber) {
                        let minePromise = isTestRPC ? web3.evm.minePromise() : web3.miner.startPromise(1);
                        return minePromise
                            .then(() => { throw new Error("Not ready yet"); });
                    }
                }),
                { max_tries: 100, interval: 1000, timeout: 100000 });
        });
}
