"use strict";

// Import the third-party libraries
const Promise = require("bluebird");

// Import the local libraries and customize the web3 environment
const addEvmFunctions = require("../utils/evmFunctions.js");

addEvmFunctions(web3);

if (typeof web3.eth.getBlockPromise !== "function") {
    Promise.promisifyAll(web3.eth, { suffix: "Promise" });
}
if (typeof web3.evm.increaseTimePromise !== "function") {
    Promise.promisifyAll(web3.evm, { suffix: "Promise" });
}
if (typeof web3.version.getNodePromise !== "function") {
    Promise.promisifyAll(web3.version, { suffix: "Promise" });
}

web3.eth.expectedExceptionPromise = require("../utils/expectedExceptionPromise.js");
web3.eth.expectedOkPromise = require("../utils/expectedOkPromise.js");
web3.eth.getPastBlock = require("../utils/getPastBlock.js");
web3.eth.getTransactionReceiptMined = require("../utils/getTransactionReceiptMined.js");
web3.eth.makeSureHasAtLeast = require("../utils/makeSureHasAtLeast.js");
web3.eth.makeSureAreUnlocked = require("../utils/makeSureAreUnlocked.js");

// Import test sets
const remittanceTestSets = require("./remittanceTestSets.js");

// Import the smart contracts
const Remittance = artifacts.require("./Remittance.sol");

contract('Remittance', function(accounts) {
    const MAX_GAS = 2000000;
    const TESTRPC_SLOW_DURATION = 1000;
    const GETH_SLOW_DURATION = 15000;
    const OWNER_COMMISSION = 100;
    const MAX_BLOCK_DURATION = 18;
    const EXCHANGE_HASH = web3.sha3("exchangeSecret");
    const BENEFICIARY_HASH = web3.sha3("beneficiarySecret");

    let isTestRPC, isGeth, slowDuration;
    before("should identify node", function() {
        return web3.version.getNodePromise()
            .then(function(node) {
                isTestRPC = node.indexOf("EthereumJS TestRPC") >= 0;
                isGeth = node.indexOf("Geth") >= 0;
                slowDuration = isTestRPC ? TESTRPC_SLOW_DURATION : GETH_SLOW_DURATION;
            });
    });

    let coinbase, owner, payer, exchange, beneficiary;
    before("should check accounts", function() {
        assert.isAtLeast(accounts.length, 5, "not enough accounts");

        return web3.eth.getCoinbasePromise()
            .then(function (_coinbase) {
                coinbase = _coinbase;
                // Coinbase gets the rewards, making calculations difficult.
                const coinbaseIndex = accounts.indexOf(coinbase);
                if (coinbaseIndex > -1) {
                    accounts.splice(coinbaseIndex, 1);
                }
                [owner, payer, exchange, beneficiary] = accounts;
                return web3.eth.makeSureAreUnlocked(accounts);
            })
            .then(function() {
                const initial_balance = web3.toWei(3, 'ether');
                return web3.eth.makeSureHasAtLeast(coinbase, [owner, payer, exchange, beneficiary], initial_balance)
                    .then(txObj => web3.eth.getTransactionReceiptMined(txObj));
            });
    });

    let instance;
    beforeEach("should deploy a Remittance instance", function() {
        return Remittance.new(OWNER_COMMISSION, MAX_BLOCK_DURATION, { from: owner, gas: MAX_GAS })
            .then(function(_instance) {
                instance = _instance;
            });
    });

    describe("#Remittance(ownerCommission, maxBlockDuration)", function() {
        describe("forbidden", function() {
            const invalidCreationTestSet = remittanceTestSets.invalidCreationTestSet;

            invalidCreationTestSet.forEach(invalidCreationTest => {
                const ownerCommission = invalidCreationTest.ownerCommission;
                const maxBlockDuration = invalidCreationTest.maxBlockDuration;

                it(`should forbid (${ownerCommission}, ${maxBlockDuration})`, function() {
                    this.slow(slowDuration);

                    return web3.eth.expectedExceptionPromise(
                        function() {
                            return Remittance.new(ownerCommission, maxBlockDuration, { from: owner, gas: MAX_GAS });
                        },
                        MAX_GAS
                    );
                });
            });
        });

        describe("allowed", function() {
            const validCreationTestSet = remittanceTestSets.validCreationTestSet;

            validCreationTestSet.forEach(validCreationTest => {
                const ownerCommission = validCreationTest.ownerCommission;
                const maxBlockDuration = validCreationTest.maxBlockDuration;

                it(`should allow (${ownerCommission}, ${maxBlockDuration})`, function() {
                    this.slow(slowDuration);

                    let instance;
                    return web3.eth.expectedOkPromise(
                        function() {
                            return Remittance.new(ownerCommission, maxBlockDuration, { from: owner, gas: MAX_GAS })
                                .then(_instance => {
                                    instance = _instance;
                                    return instance;
                                });
                        },
                        MAX_GAS
                    )
                    .then(() => {
                        return web3.eth.getTransactionReceiptMined(instance.transactionHash);
                    })
                    .then(receipt => {
                        assert.strictEqual(receipt.logs.length, 1);
                        return instance.ownerCommission();
                    })
                    .then(_ownerCommission => {
                        assert.strictEqual(_ownerCommission.toNumber(), web3.toBigNumber(ownerCommission).toNumber(),
                            "ownerCommission not assigned in constructor");
                        return instance.maxBlockDuration();
                    })
                    .then(_maxBlockDuration => {
                        assert.equal(_maxBlockDuration.toNumber(), web3.toBigNumber(maxBlockDuration).toNumber(),
                            "maxBlockDuration not assigned in constructor");
                        return instance.raisedFees();
                    })
                    .then(_raisedFees => {
                        assert.strictEqual(_raisedFees.toNumber(), 0,
                            "raisedFees not zero after constructor");
                    });
                });
            });
        });

        it.skip("should emit LogRemittanceCreation event", function() {
            this.slow(slowDuration);
        });
    });

    describe("#hash(hash1, hash2, exchange)", function() {
        it("should use the exchange hash to calculate the compound hash", function() {
            this.slow(slowDuration);

            let compoundHash1;
            return instance.hash(EXCHANGE_HASH, BENEFICIARY_HASH, exchange)
                .then(_compoundHash1 => {
                    compoundHash1 = _compoundHash1;
                    return instance.hash(web3.sha3(""), BENEFICIARY_HASH, exchange);
                })
                .then(_compoundHash2 => {
                    assert.notEqual(compoundHash1, _compoundHash2, "Exchange hash is ignored in hash calculation");
                });
        });
        it("should use the beneficiary hash to calculate the compound hash", function() {
            this.slow(slowDuration);

            let compoundHash1;
            return instance.hash(EXCHANGE_HASH, BENEFICIARY_HASH, exchange)
                .then(_compoundHash1 => {
                    compoundHash1 = _compoundHash1;
                    return instance.hash(EXCHANGE_HASH, web3.sha3(""), exchange);
                })
                .then(_compoundHash2 => {
                    assert.notEqual(compoundHash1, _compoundHash2, "Beneficiary hash is ignored in hash calculation");
                });
        });
        it("should use the contract instance to calculate the compound hash", function() {
            this.slow(slowDuration);

            let compoundHash1;
            return instance.hash(EXCHANGE_HASH, BENEFICIARY_HASH, exchange)
                .then(_compoundHash1 => {
                    compoundHash1 = _compoundHash1;
                    return Remittance.new(OWNER_COMMISSION, MAX_BLOCK_DURATION, { from: owner, gas: MAX_GAS });
                })
                .then(_instance2 => {
                    return _instance2.hash(EXCHANGE_HASH, BENEFICIARY_HASH, exchange)
                })
                .then(_compoundHash2 => {
                    assert.notEqual(compoundHash1, _compoundHash2, "Instance is ignored in hash calculation");
                });
        });
        it("should not use anything else to calculate compound hash", function() {
            this.slow(slowDuration);

            let compoundHash1;
            return instance.hash(EXCHANGE_HASH, BENEFICIARY_HASH, exchange)
                .then(_compoundHash1 => {
                    compoundHash1 = _compoundHash1;
                    return instance.hash(EXCHANGE_HASH, BENEFICIARY_HASH, exchange);
                })
                .then(_compoundHash2 => {
                    assert.strictEqual(compoundHash1, _compoundHash2, "Something else is used in hash calculation");
                });
        });
    });

    describe("#setOwnerCommission(newOwnerCommission)", function() {
        it("should forbid if called when paused", function() {
            this.slow(slowDuration);

            return instance.pause({ from: owner, gas: MAX_GAS })
                .then(() => instance.ownerCommission())
                .then(_ownerCommission => {
                    const newOwnerCommission = _ownerCommission.plus(1);

                    return web3.eth.expectedExceptionPromise(
                        function() {
                            return instance.setOwnerCommission(newOwnerCommission, { from: owner, gas: MAX_GAS });
                        },
                        MAX_GAS
                    );
                });
        });
        it("should forbid if called by non owner", function() {
            this.slow(slowDuration);

            return instance.ownerCommission()
                .then(_ownerCommission => {
                    const newOwnerCommission = _ownerCommission.plus(1);

                    return web3.eth.expectedExceptionPromise(
                        function() {
                            return instance.setOwnerCommission(newOwnerCommission, { from: payer, gas: MAX_GAS });
                        },
                        MAX_GAS
                    );
                });
        });
        it("should forbid new owner commission equal to the old one", function() {
            this.slow(slowDuration);

            return instance.ownerCommission()
                .then(_ownerCommission => {
                    return web3.eth.expectedExceptionPromise(
                        function() {
                            return instance.setOwnerCommission(_ownerCommission, { from: owner, gas: MAX_GAS });
                        },
                        MAX_GAS
                    );
                });
        });
        it.skip("should emit LogOwnerCommissionChanged event", function() {
            this.slow(slowDuration);
        });
    });

    describe("#deposit(compoundHash, blockDuration)", function() {
        const blockDuration = 1;
        const money = OWNER_COMMISSION + 1;

        it("should fail if called when paused", function() {
            this.slow(slowDuration);

            return instance.pause({ from: owner, gas: MAX_GAS })
                .then(() => instance.hash(EXCHANGE_HASH, BENEFICIARY_HASH, exchange))
                .then(_compoundHash => {
                    return web3.eth.expectedExceptionPromise(
                        function() {
                            return instance.deposit(_compoundHash, blockDuration,
                                { from: payer, gas: MAX_GAS, value: money });
                        },
                        MAX_GAS
                    );
                });
        });
        it("should fail if compoundHash is zero", function() {
            this.slow(slowDuration);

            return web3.eth.expectedExceptionPromise(
                function() {
                    return instance.deposit(0, blockDuration, { from: payer, gas: MAX_GAS, value: money });
                },
                MAX_GAS
            );
        });
        it("should fail if blockDuration is greater than maxBlockDuration", function() {
            this.slow(slowDuration);
            
            return instance.hash(EXCHANGE_HASH, BENEFICIARY_HASH, exchange)
                .then(_compoundHash => {
                    return web3.eth.expectedExceptionPromise(
                        function() {
                            return instance.deposit(_compoundHash, MAX_BLOCK_DURATION + 1,
                                { from: payer, gas: MAX_GAS, value: money });
                        },
                        MAX_GAS
                    );
                });
        });
        it("should fail if no ether is sent", function() {
            this.slow(slowDuration);

            return instance.hash(EXCHANGE_HASH, BENEFICIARY_HASH, exchange)
                .then(_compoundHash => {
                    return web3.eth.expectedExceptionPromise(
                        function() {
                            return instance.deposit(_compoundHash, blockDuration,
                                { from: payer, gas: MAX_GAS });
                        },
                        MAX_GAS
                    );
                });
        });
        it("should fail if money sent is not greater than owner commission", function() {
            this.slow(slowDuration);

            return instance.hash(EXCHANGE_HASH, BENEFICIARY_HASH, exchange)
                .then(_compoundHash => {
                    return web3.eth.expectedExceptionPromise(
                        function() {
                            return instance.deposit(_compoundHash, blockDuration,
                                { from: payer, gas: MAX_GAS, value: OWNER_COMMISSION });
                        },
                        MAX_GAS
                    );
                });
        });
        it.skip("should fail if payer is different from the ", function() {
            this.slow(slowDuration);
        });
        it.skip("should emit LogDeposit event", function() {
            this.slow(slowDuration);
        });
    });

    describe("#()", function() {
        it("should refuse any ether sent directly", function() {
            this.slow(slowDuration);

            return web3.eth.expectedExceptionPromise(
                function() {
                    return instance.sendTransaction({ from: payer, gas: MAX_GAS, value: 1 });
                },
                MAX_GAS
            );
        });
    });
});
