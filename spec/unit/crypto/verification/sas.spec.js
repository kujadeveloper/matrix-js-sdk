/*
Copyright 2018 New Vector Ltd

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

try {
    global.Olm = require('olm');
} catch (e) {
    console.warn("unable to run megolm backup tests: libolm not available");
}

import expect from 'expect';

import sdk from '../../../..';
import WebStorageSessionStore from '../../../../lib/store/session/webstorage';
import MemoryCryptoStore from '../../../../lib/crypto/store/memory-crypto-store.js';
import MockStorageApi from '../../../MockStorageApi';
import testUtils from '../../../test-utils';

import OlmDevice from '../../../../lib/crypto/OlmDevice';
import Crypto from '../../../../lib/crypto';
import DeviceInfo from '../../../../lib/crypto/deviceinfo';

import {SASSend, SASReceive} from '../../../../lib/crypto/verification/SAS';

const Olm = global.Olm;

const MatrixClient = sdk.MatrixClient;
const MatrixEvent = sdk.MatrixEvent;

describe("SAS verification", function() {
    if (!global.Olm) {
        console.warn('Not running megolm backup unit tests: libolm not present');
        return;
    }

    beforeEach(async function() {
        await Olm.init();
    });

    it("should error on an unexpected event", async function() {
        const sas = new SASReceive({}, "@alice:example.com", "ABCDEFG");
        sas.handleEvent(new MatrixEvent({
            sender: "@alice:example.com",
            type: "es.inquisition",
            content: {},
        }));
        const spy = expect.createSpy();
        await sas.verify()
            .catch(spy);
        expect(spy).toHaveBeenCalled();
    });

    it("should verify a key", async function() {
        let bob;
        let bobResolve;
        const bobPromise = new Promise((resolve, reject) => {
            bobResolve = resolve;
        });
        const alice = new SASSend({
            userId: "@alice:example.com",
            deviceId: "ABCDEFG",
            sendToDevice: function(type, map) {
                if (map["@bob:example.com"] && map["@bob:example.com"]["HIJKLMN"]) {
                    const event = new MatrixEvent({
                        sender: "@alice:example.com",
                        type: type,
                        content: map["@bob:example.com"]["HIJKLMN"],
                    });
                    console.log("alice sends to bob:", type, map["@bob:example.com"]["HIJKLMN"]);
                    if (type === "m.key.verification.start") {
                        expect(bob).toNotExist();
                        bob = new SASReceive({
                            userId: "@bob:example.com",
                            deviceId: "HIJKLMN",
                            sendToDevice: function(type, map) {
                                if (map["@alice:example.com"]
                                    && map["@alice:example.com"]["ABCDEFG"]) {
                                    console.log("bob sends to alice:", type, map["@alice:example.com"]["ABCDEFG"]);
                                    alice.handleEvent(new MatrixEvent({
                                        sender: "@bob:example.com",
                                        type: type,
                                        content: map["@alice:example.com"]["ABCDEFG"],
                                    }));
                                }
                            },
                            getStoredDevice: () => {
                                return new DeviceInfo({}, "ABCDEFG");
                            },
                            setDeviceVerified: expect.createSpy(),
                        }, "@alice:example.com", "ABCDEFG", "transaction", event);
                        bobResolve();
                    } else {
                        bob.handleEvent(event);
                    }
                }
            },
            getStoredDevice: () => {
                return new DeviceInfo({}, "HIJKLMN");
            },
            setDeviceVerified: expect.createSpy(),
        }, "@bob:example.com", "HIJKLMN", "transaction");
        let aliceSasEvent;
        let bobSasEvent;
        alice.on("show_sas", (e) => {
            if (!bobSasEvent) {
                aliceSasEvent = e;
            } else if (e.sas === bobSasEvent.sas) {
                e.confirm();
                bobSasEvent.confirm();
            } else {
                alice.cancel(new Error("Mismatched SAS"));
                bob.cancel(new Error("Mismatch SAS"));
            }
        });
        alice.verify();
        await bobPromise;
        bob.on("show_sas", (e) => {
            if (!aliceSasEvent) {
                bobSasEvent = e;
            } else if (e.sas === aliceSasEvent.sas) {
                e.confirm();
                aliceSasEvent.confirm();
            } else {
                alice.cancel(new Error("Mismatched SAS"));
                bob.cancel(new Error("Mismatch SAS"));
            }
        });
        await bob.verify();
        await alice.verify();
        expect(alice._baseApis.setDeviceVerified)
            .toHaveBeenCalledWith("@bob:example.com", "HIJKLMN");
        expect(bob._baseApis.setDeviceVerified)
            .toHaveBeenCalledWith("@alice:example.com", "ABCDEFG");
    });
});
