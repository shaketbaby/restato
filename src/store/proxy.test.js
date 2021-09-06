import test from "tape";

import { deepFreeze, getTypeOf } from "./utils.js";
import { createProxy } from "./proxy.js";

test("createProxy", async (t) => {
  function newProxy(target) {
    const copies = [];
    const listeners = [];
    const onCopied = (copy) => copies.push(copy);
    const whenComitted = (listener) => listeners.push(listener);
    const { proxy, revoke } = createProxy(target, onCopied, whenComitted);
    const commit = () => {
      listeners.forEach(l => l());
      listeners.length = 0; // empty listeners array
    };
    return { proxy, copies, listeners, commit, revoke };
  }

  // tape.deepEqual doesn't like the Map proxy
  // convert to native Map before comparison
  function toNative(proxy) {
    switch (getTypeOf(proxy)) {
      case "array":
        return proxy.map(toNative);
      case "map":
        const map = new Map();
        proxy.forEach((value, key) => map.set(key, toNative(value)));
        return map;
      case "object":
        const mapped = {};
        Object.keys(proxy).forEach(key => {
          mapped[key] = toNative(proxy[key]);
        });
        return mapped;
    }
    return proxy;
  }

  t.test("for primitive types", async (tt) => {
    for (const v of [0, 1n, true, "", null, undefined, Symbol("symbol"), () => { }]) {
      const type = v === null ? 'null' : typeof (v);
      tt.equal(newProxy(v).proxy, v, `returns "${type}" value as is`);
    }
  });

  t.test("for Object", async (tt) => {
    tt.test("returns a proxy", async (ttt) => {
      const target = deepFreeze({
        str: "string",
        array: ["item"],
        object: { prop: "value" },
      });
      const { proxy, copies, listeners } = newProxy(target);
      ttt.notEqual(proxy, target, "proxy and target is not ===");
      ttt.deepEqual(proxy, target, "proxy and target have same content");

      ttt.equal(proxy.str, "string", "returns simple value as is");
      ttt.equal(proxy.undefined, undefined, "returns undefined for non-exist prop");

      const arrayProxy = proxy.array;
      ttt.notEqual(arrayProxy, target.array, "returns a proxy for nested array");
      ttt.deepEqual(arrayProxy, target.array, "nested array proxy has same content");
      ttt.deepEqual(proxy.array, arrayProxy, "returns same proxy for same nested array");

      const objectProxy = proxy.object;
      ttt.notEqual(objectProxy, target.object, "returns a proxy for nested object");
      ttt.deepEqual(objectProxy, target.object, "nested object proxy has same content");
      ttt.deepEqual(proxy.object, objectProxy, "returns same proxy for same nested object");

      ttt.deepEqual(copies, [], "does not create copy for reads");
      ttt.deepEqual(listeners, [], "does not register commit listener for reads");
    });

    tt.test("update primitive prop", async (ttt) => {
      const target = deepFreeze({});
      const { proxy, copies, listeners, commit } = newProxy(target);

      proxy.prop = "value";
      ttt.equal(proxy.prop, "value", "can set new prop and then get it");
      ttt.deepEqual(listeners.length, 1, "registers commit listener on first mutate");
      ttt.deepEqual(copies, [{ prop: "value" }], "make a copy on first mutate");
      ttt.equal(Object.isFrozen(copies[0]), false, "copy is not frozen at first");

      const lastCopy = copies[0];
      proxy.prop = 100;
      ttt.equal(copies[0], lastCopy, "mutate copy in place when mutate again");
      ttt.deepEqual(copies, [{ prop: 100 }], "copy relfects latest changes");

      commit();
      ttt.equal(Object.isFrozen(copies[0]), true, "copy is frozen after commit");

      proxy.newProp = true;
      const expectedCopies = [{ prop: 100 }, { prop: 100, newProp: true }];
      ttt.deepEqual(copies, expectedCopies, "after commit, make another copy when mutate again");
      ttt.deepEqual(proxy, copies[1], "proxy and last copy have same content");

      ttt.deepEqual(target, {}, "target is left untouched");
    });

    tt.test("update nested object prop", async (ttt) => {
      const target = deepFreeze({});
      const { proxy, copies, listeners, commit } = newProxy(target);

      proxy.object = { prop: "value" };
      ttt.deepEqual(proxy.object, { prop: "value" }, "can set new object prop and then get it");
      ttt.deepEqual(listeners.length, 1, "registers commit listener on first mutate");
      ttt.deepEqual(copies, [{ object: { prop: "value" } }], "make a copy on first mutate");

      const lastCopy = copies[0];
      const lastObjectCopy = lastCopy.object;
      ttt.equal(Object.isFrozen(lastCopy), false, "copy is not frozen at first");
      ttt.equal(Object.isFrozen(lastObjectCopy), true, "new object is frozen immediately");

      const objectProxy = proxy.object;

      objectProxy.prop = 100;
      ttt.notEqual(lastCopy.object, lastObjectCopy, "make a copy for nested object")
      ttt.equal(copies[0], lastCopy, "mutate root copy in place when mutate nested object");
      ttt.deepEqual(copies, [{ object: { prop: 100 } }], "copy relfects latest changes");
      ttt.deepEqual(listeners.length, 2, "registers commit listener on first mutate to nested object");

      commit();
      ttt.equal(Object.isFrozen(lastCopy), true, "copy is frozen after commit");
      ttt.deepEqual(listeners.length, 0, "commit listeners are cleared after commit");

      proxy.object.newProp = true;
      ttt.equal(objectProxy.newProp, true, "existing nested proxy reflects new changes made using full path");

      const expectedCopies = [
        { object: { prop: 100 } },
        { object: { prop: 100, newProp: true } }
      ];
      ttt.deepEqual(copies, expectedCopies, "after commit, make another copy when mutate again");
      ttt.deepEqual(proxy, copies[1], "proxy and last copy have same content");
      ttt.deepEqual(listeners.length, 2, "registers commit listener for each proxy again after commit");

      proxy.object = { another: true };
      ttt.deepEqual(objectProxy, { another: true }, "existing nested proxy points to new value when prop is set to a new value of same type");

      proxy.object = [];
      const revokedErrpr = /Cannot perform 'get' on a proxy that has been revoked/;
      ttt.throws(() => objectProxy.length, revokedErrpr, "existing nested proxy is revoked when prop is set to a value of different type");

      ttt.deepEqual(target, {}, "target is left untouched");
    });

    tt.test("update nested array prop", async (ttt) => {
      const target = deepFreeze({});
      const { proxy, copies, listeners, commit } = newProxy(target);

      proxy.array = ["item"];
      ttt.deepEqual(proxy.array, ["item"], "can set new array prop and then get it");
      ttt.deepEqual(listeners.length, 1, "registers commit listener on first mutate");
      ttt.deepEqual(copies, [{ array: ["item"] }], "make a copy on first mutate");

      const lastCopy = copies[0];
      const lastArrayCopy = lastCopy.array;
      ttt.equal(Object.isFrozen(lastCopy), false, "copy is not frozen at first");
      ttt.equal(Object.isFrozen(lastArrayCopy), true, "new array is frozen immediately");

      const arrayProxy = proxy.array;

      arrayProxy[0] = 100;
      ttt.notEqual(lastCopy.array, lastArrayCopy, "make a copy for nested array")
      ttt.equal(copies[0], lastCopy, "mutate root copy in place when mutate nested array");
      ttt.deepEqual(copies, [{ array: [100] }], "copy relfects latest changes");
      ttt.deepEqual(listeners.length, 2, "registers commit listener on first mutate to nested array");

      commit();
      ttt.equal(Object.isFrozen(lastCopy), true, "copy is frozen after commit");
      ttt.deepEqual(listeners.length, 0, "commit listeners are cleared after commit");

      proxy.array[1] = true;
      ttt.equal(arrayProxy[1], true, "existing nested proxy reflects new changes made using full path");

      const expectedCopies = [
        { array: [100] },
        { array: [100, true] }
      ];
      ttt.deepEqual(copies, expectedCopies, "after commit, make another copy when mutate again");
      ttt.deepEqual(proxy, copies[1], "proxy and last copy have same content");
      ttt.deepEqual(listeners.length, 2, "registers commit listener for each proxy again after commit");

      proxy.array = ["another"];
      ttt.deepEqual(arrayProxy, ["another"], "existing nested proxy points to new value when prop is set to a new value of same type");

      proxy.array = { length: 1 };
      const revokedErrpr = /Cannot perform 'get' on a proxy that has been revoked/;
      ttt.throws(() => arrayProxy.length, revokedErrpr, "existing nested proxy is revoked when prop is set to a value of different type");

      ttt.deepEqual(target, {}, "target is left untouched");
    });

    tt.test("update nested map prop", async (ttt) => {
      const target = deepFreeze({});
      const { proxy, copies, listeners, commit } = newProxy(target);

      proxy.map = new Map(Object.entries({ prop: "value" }));
      ttt.deepEqual(toNative(proxy.map), new Map([["prop", "value"]]), "can set new map prop and then get it");
      ttt.deepEqual(listeners.length, 1, "registers commit listener on first mutate");
      ttt.deepEqual(toNative(copies), [{ map: new Map([["prop", "value"]]) }], "make a copy on first mutate");

      const lastCopy = copies[0];
      const lastMapCopy = lastCopy.map;
      ttt.equal(Object.isFrozen(lastCopy), false, "copy is not frozen at first");
      ttt.equal(Object.isFrozen(lastMapCopy), true, "new map is frozen immediately");
      ttt.throws(() => lastMapCopy.clear(), /Can not mutate frozen map/, "can not mutate frozen map");

      const mapProxy = proxy.map;

      mapProxy.set("prop", 100);
      ttt.notEqual(lastCopy.map, lastMapCopy, "make a copy for nested map")
      ttt.equal(copies[0], lastCopy, "mutate root copy in place when mutate nested map");
      ttt.deepEqual(toNative(copies), [{ map: new Map([["prop", 100]]) }], "copy relfects latest changes");
      ttt.deepEqual(listeners.length, 2, "registers commit listener on first mutate to nested map");

      commit();
      ttt.equal(Object.isFrozen(lastCopy), true, "copy is frozen after commit");
      ttt.deepEqual(listeners.length, 0, "commit listeners are cleared after commit");

      proxy.map.set("newProp", true);
      ttt.equal(mapProxy.get("newProp"), true, "existing nested proxy reflects new changes made using full path");

      const expectedCopies = [
        { map: new Map([["prop", 100]]) },
        { map: new Map([["prop", 100], ["newProp", true]]) },
      ];
      ttt.deepEqual(toNative(copies), expectedCopies, "after commit, make another copy when mutate again");
      ttt.deepEqual(toNative(proxy), expectedCopies[1], "proxy and last copy have same content");
      ttt.deepEqual(listeners.length, 2, "registers commit listener for each proxy again after commit");

      proxy.map = new Map([["another", true]]);
      ttt.deepEqual(toNative(mapProxy), new Map([["another", true]]), "existing nested proxy points to new value when prop is set to a new value of same type");

      proxy.map = { size: 1 };
      const revokedErrpr = /Cannot perform 'get' on a proxy that has been revoked/;
      ttt.throws(() => mapProxy.size, revokedErrpr, "existing nested proxy is revoked when prop is set to a value of different type");

      ttt.deepEqual(target, {}, "target is left untouched");
    });

    tt.test("delete properties", async (ttt) => {
      const target = deepFreeze({ num: 1, array: [{ map: new Map() }] });
      const { proxy, copies, listeners, commit } = newProxy(target);

      const arrayProxy = proxy.array;
      const objectProxy = arrayProxy[0];
      const mapProxy = proxy.array[0].map;
      const revokedErrpr = /Cannot perform 'get' on a proxy that has been revoked/;

      delete objectProxy.map;
      ttt.deepEqual(objectProxy, {}, "can delete a prop from nested object");
      ttt.throws(() => mapProxy.size, revokedErrpr, "existing nested proxy is revoked when prop is deleted");
      ttt.deepEqual(listeners.length, 3, "registers a commit listener for each mutated proxy");
      ttt.deepEqual(copies, [{ num: 1, array: [{}] }], "make a copy on first delete");
      ttt.equal(Object.isFrozen(copies[0]), false, "copy is not frozen at first");
      ttt.equal(Object.isFrozen(copies[0].array), false, "copy is not frozen at first");
      ttt.equal(Object.isFrozen(copies[0].array[0]), false, "copy is not frozen at first");

      delete proxy.num;
      ttt.equal(Reflect.has(proxy, "num"), false, "can delete primitive prop");
      ttt.deepEqual(copies, [{ array: [{}] }], false, "mutate last copy in place when delete again");

      commit();
      ttt.equal(Object.isFrozen(copies[0]), true, "copy is frozen after commit");
      ttt.equal(Object.isFrozen(copies[0].array), true, "copy is frozen after commit");
      ttt.equal(Object.isFrozen(copies[0].array[0]), true, "copy is frozen after commit");
      ttt.deepEqual(listeners.length, 0, "commit listeners are cleared after commit");

      delete proxy.array;
      ttt.throws(() => arrayProxy.length, revokedErrpr, "existing nested proxy is revoked when prop is deleted");
      ttt.throws(() => objectProxy.foo, revokedErrpr, "existing child proxy of the deleted prop is also revoked");
      ttt.deepEqual(copies, [{ array: [{}] }, {}], "make a copy again on first delete after commit");
      ttt.deepEqual(listeners.length, 1, "registers a commit listener for each mutated proxy");

      ttt.deepEqual(toNative(target), { num: 1, array: [{ map: new Map() }] }, "target is left untouched");
    });

    tt.test("mutate value returned from Object.values()", async (ttt) => {
      const target = deepFreeze({ num: 1, object: {} });
      const { proxy, copies, listeners, commit } = newProxy(target);

      const values = Object.values(proxy);
      ttt.deepEqual(values, [1, {}], "can get object values");

      values[1].prop = "value";
      ttt.deepEqual(listeners.length, 2, "registers commit listener for each proxy");
      ttt.deepEqual(copies, [{ num: 1, object: { prop: "value" } }], "make a copy when mutate a value");
      ttt.equal(Object.isFrozen(copies[0]), false, "copy is not frozen at first");
      ttt.equal(Object.isFrozen(copies[0].object), false, "object copy is not frozen at first");

      commit();
      ttt.equal(Object.isFrozen(copies[0]), true, "copy is frozen after commit");
      ttt.equal(Object.isFrozen(copies[0].object), true, "object copy is frozen after commit");
    });

    tt.test("mutate value returned from Object.entries()", async (ttt) => {
      const target = deepFreeze({ num: 1, object: {} });
      const { proxy, copies, listeners, commit } = newProxy(target);

      const values = Object.entries(proxy);
      ttt.deepEqual(values, [["num", 1], ["object", {}]], "can get object entries");

      values[1][1].prop = "value";
      ttt.deepEqual(listeners.length, 2, "registers a commit listener for each proxy");
      ttt.deepEqual(copies, [{ num: 1, object: { prop: "value" } }], "make a copy when mutate a value");
      ttt.equal(Object.isFrozen(copies[0]), false, "copy is not frozen at first");
      ttt.equal(Object.isFrozen(copies[0].object), false, "object copy is not frozen at first");

      commit();
      ttt.equal(Object.isFrozen(copies[0]), true, "copy is frozen after commit");
      ttt.equal(Object.isFrozen(copies[0].object), true, "object copy is frozen after commit");
    });

    tt.test("mutate prototype", async (ttt) => {
      const target = deepFreeze({});
      const { proxy, copies, listeners } = newProxy(target);

      let proto = Object.getPrototypeOf(proxy);
      ttt.equal(Object.setPrototypeOf(proxy, proto), proxy, "can set prototype to same object")
      ttt.deepEqual(listeners, [], "does not register a commit listener");
      ttt.deepEqual(copies, [], "does not make a copy ");

      proto = { [Symbol("prototype")]: true };

      ttt.equal(Object.setPrototypeOf(proxy, proto), proxy, "can set prototype to a different object");
      ttt.equal(Object.getPrototypeOf(proxy), proto, "can get the newly set prototype");
      ttt.deepEqual(listeners.length, 1, "registers a commit listener");
      ttt.deepEqual(copies, [Object.setPrototypeOf({}, proto)], "make a copy ");
      ttt.equal(Object.getPrototypeOf(copies[0]), proto, "copy has correct prototype");
      ttt.notEqual(copies[0], target, "copy !== target");
    });

    tt.test("reassign prop", async (ttt) => {
      const target = deepFreeze({
        object: {
          wontExist: {},
          typeWillChange: {},
          valueWillChange: { k: "v" },
          notTouchedTypeWillChange: {},
        }
      });
      const { proxy } = newProxy(target);
      const objectProxy = proxy.object;
      const wontExistProxy = proxy.object.wontExist;
      const typeWillChangeProxy = objectProxy.typeWillChange;
      const valueWillChangeProxy = proxy.object.valueWillChange;
      // reassign object
      proxy.object = {
        typeWillChange: [],
        valueWillChange: { k: "v2" },
        notTouchedTypeWillChange: ["not touched"],
      };
      const revokedErrpr = /Cannot perform 'get' on a proxy that has been revoked/;
      ttt.equal(Reflect.has(objectProxy, "wontExist"), false, "old proxy of updated prop does not have removed child prop");
      ttt.throws(() => wontExistProxy.foo, revokedErrpr, "old proxy of removed child prop is revoked");
      ttt.equal(objectProxy.wontExist, undefined, "returns undefined for removed child prop");

      ttt.throws(() => typeWillChangeProxy.foo, revokedErrpr, "old proxy of type changing child is revoked");
      ttt.deepEqual(objectProxy.typeWillChange, [], "returns new value for type changing child");

      ttt.deepEqual(valueWillChangeProxy, { k: "v2" }, "old proxy of value changing child reflects latest value");
      ttt.deepEqual(objectProxy.valueWillChange, { k: "v2" }, "returns new value for value changing child");

      ttt.deepEqual(objectProxy.notTouchedTypeWillChange, ["not touched"], "returns new value for not touched child");
    });
  });

  t.test("for Array", async (tt) => {
    tt.test("basic operations", async (ttt) => {
      const target = deepFreeze([{}, "string"]);
      const { proxy, copies, listeners, commit, revoke } = newProxy(target);
      ttt.notEqual(proxy, target, "can create proxy");
      ttt.deepEqual(proxy, target, "has the same content");
      ttt.deepEqual(proxy[0], {}, "can access object item");
      ttt.deepEqual(proxy[1], "string", "can access string item");

      proxy.push([]);
      ttt.deepEqual(proxy[2], [], "can push a new array item");
      ttt.deepEqual(copies, [[{}, "string", []]], "create a copy on push");
      ttt.equal(listeners.length, 1, "registers a commit listener for array proxy");

      proxy[3] = new Map([["k", "v"]]);
      ttt.deepEqual(toNative(proxy[3]), new Map([["k", "v"]]), "can set a map item using index");
      ttt.deepEqual(toNative(copies), [[{}, "string", [], new Map([["k", "v"]])]], "mutate the last copy in place");
      ttt.deepEqual(toNative(proxy), toNative(copies[0]), "proxy reflects the latest copy");
      ttt.equal(proxy.length, 4, "proxy has correct size");
      ttt.equal(listeners.length, 1, "does not register commit listener again");

      ttt.equal(Object.isFrozen(copies[0][2]), true, "newly pushed array is frozen");
      ttt.equal(Object.isFrozen(copies[0][3]), true, "newly pushed map is frozen");
      ttt.equal(Object.isFrozen(copies[0]), false, "new copy is not frozen");

      commit();
      ttt.equal(Object.isFrozen(copies[0]), true, "new copy is frozen after commit");

      const objectProxy = proxy[0];
      const arrayProxy = proxy[2];
      const mapProxy = proxy[3];

      proxy[0].prop = "value";
      ttt.equal(objectProxy.prop, "value", "can mutate object item");

      proxy[2].push("subArray");
      ttt.deepEqual(arrayProxy, ["subArray"], "can mutate array item");

      proxy[3].clear();
      ttt.deepEqual(new Map(mapProxy), new Map(), "can mutate map item");

      revoke();
      const revokedError = /Cannot perform 'get' on a proxy that has been revoked/;
      ttt.throws(() => proxy.length, revokedError, "proxy can not be used after revoked");
      ttt.throws(() => mapProxy.length, revokedError, "map proxy can not be used after parent is revoked");
      ttt.throws(() => arrayProxy.length, revokedError, "array proxy can not be used after parent is revoked");
      ttt.throws(() => objectProxy.length, revokedError, "object proxy can not be used after parent is revoked");
    });

    tt.test("mutate value returned from Array.map()", async (ttt) => {
      const target = deepFreeze([new Map(), 10]);
      const { proxy, copies, listeners, commit } = newProxy(target);

      const values = proxy.map(v => v);
      ttt.deepEqual(toNative(values), [new Map(), 10], "Array.map works as expected");

      values[0].set("k", "v");
      ttt.deepEqual(toNative(proxy[0]), new Map([["k", "v"]]), "change reflects in proxy");
      ttt.deepEqual(listeners.length, 2, "registers a commit listener for each proxy");
      ttt.deepEqual(toNative(copies), [[new Map([["k", "v"]]), 10]], "make a copy when mutate an map value");
      ttt.equal(Object.isFrozen(copies[0]), false, "copy is not frozen at first");
      ttt.equal(Object.isFrozen(copies[0][0]), false, "map copy is not frozen at first");

      commit();
      ttt.equal(Object.isFrozen(copies[0]), true, "copy is frozen after commit");
      ttt.equal(Object.isFrozen(copies[0][0]), true, "map copy is frozen after commit");
    });
  });

  t.test("for Map", async (tt) => {
    tt.test("basic operations", async (ttt) => {
      const target = deepFreeze(new Map([
        ["object", {}],
        ["string", "string"],
      ]));

      const { proxy, copies, commit } = newProxy(target);
      ttt.notEqual(proxy, target, "can create proxy");
      ttt.equal(getTypeOf(proxy), "map", "is instance of Map");
      ttt.deepEqual(toNative(proxy), toNative(target), "has the same entries");
      ttt.deepEqual(proxy.get("object"), {}, "can access array entry");
      ttt.deepEqual(proxy.get("string"), "string", "can access string entry");
      ttt.deepEqual(copies, [], "do not copy for read access");

      proxy.set("array", []);
      ttt.equal(proxy.size, 3, "has correct size");
      ttt.deepEqual(proxy.get("array"), [], "can set a new array entry");
      ttt.deepEqual(toNative(copies), [new Map([["object", {}], ["string", "string"], ["array", []]])], "create a copy");

      proxy.get("object").k = "v";
      ttt.deepEqual(proxy.get("object"), { k: "v" }, "can mutate object entry");
      ttt.deepEqual(toNative(copies), [new Map([["object", { k: "v" }], ["string", "string"], ["array", []]])], "create a copy");
      ttt.deepEqual(toNative(proxy), toNative(copies[copies.length - 1]), "proxy reflects the latest copy");

      commit();
      ttt.comment("after changes are committed");

      proxy.get("array").unshift(10, { map: new Map() }, ["Jan", "Jan", "April"]);
      proxy.get("array")[0] = 100;

      const nestedObj = proxy.get("array")[1];
      const { map }= nestedObj;

      nestedObj.map = new Map(Object.entries({ foo: "bar" }));

      ttt.equal(map.get("foo"), "bar", "prop proxy reflects latest value");

      const nestedArr = proxy.get("array")[2];
      nestedArr.splice(1, 1, "Feb", "Mar");

      const expected = [
        new Map([
          ["object", { k: "v" }],
          ["string", "string"],
          ["array", []]
        ]),
        new Map([
          ["object", { k: "v" }],
          ["string", "string"],
          ["array", [100, { map: new Map([["foo", "bar"]]) }, ["Jan", "Feb", "Mar", "April"]]]
        ]),
      ];
      ttt.deepEqual(toNative(copies), expected, "makes a new copy with changes");
      ttt.deepEqual([...nestedObj.map.values()], ["bar"], "return correct values");
      ttt.deepEqual(Array.from(proxy.keys()), ["object", "string", "array"], "return correct keys");
      ttt.deepEqual(proxy.get("array").map(getTypeOf), ["number", "object", "array"], "can map nested array");

      const arrProxy = proxy.get("array");
      arrProxy[1].map.delete("foo");
      ttt.equal(map.has("foo"), false, "has return false after key is deleted");

      arrProxy[1].map = {};
      ttt.throws(() => map.size, /Cannot perform 'get' on a proxy that has been revoked/);

      proxy.delete("array");
      ttt.throws(() => arrProxy[0], /Cannot perform 'get' on a proxy that has been revoked/);
    });

    tt.test("mutate value returned from Map.forEach()", async (ttt) => {
      const target = deepFreeze(new Map([
        ["object", { k: "v" }],
        ["string", "string"],
      ]));
      const { proxy, copies, listeners, commit } = newProxy(target);

      const $this = Symbol("this");
      const forEachActual = [];
      proxy.forEach(
        function(value, key, p) {
          forEachActual.push([key, value, p, this]);
        },
        $this
      );
      const forEachExpected = [
        ["object", { k: "v" }, proxy, $this],
        ["string", "string", proxy, $this],
      ];
      ttt.deepEqual(forEachActual, forEachExpected, "forEach works as expected");

      forEachActual[0][1].k = "new";
      ttt.deepEqual(proxy.get("object"), { k: "new" }, "change reflects in proxy");
      ttt.deepEqual(listeners.length, 2, "registers a commit listener for each proxy");
      ttt.deepEqual(toNative(copies), [new Map([["object", { k: "new" }], ["string", "string"] ])], "make a copy when mutate an object value");
      ttt.equal(Object.isFrozen(copies[0]), false, "copy is not frozen at first");
      ttt.equal(Object.isFrozen(copies[0].get("object")), false, "object copy is not frozen at first");

      commit();
      ttt.equal(Object.isFrozen(copies[0]), true, "copy is frozen after commit");
      ttt.equal(Object.isFrozen(copies[0].get("object")), true, "object copy is frozen after commit");
    });

    tt.test("mutate value returned from Map.entries()", async (ttt) => {
      const target = deepFreeze(new Map([
        ["array", []],
        [10, 10],
      ]));
      const { proxy, copies, listeners, commit } = newProxy(target);

      const entries = [...proxy.entries()];
      ttt.deepEqual(entries, [["array", []], [10, 10]], "Map.entries works as expected");

      entries[0][1].push("new");
      ttt.deepEqual(proxy.get("array"), ["new"], "change reflects in proxy");
      ttt.deepEqual(listeners.length, 2, "registers a commit listener for each proxy");
      ttt.deepEqual(toNative(copies), [new Map([["array", ["new"]], [10, 10]])], "make a copy when mutate an array value");
      ttt.equal(Object.isFrozen(copies[0]), false, "copy is not frozen at first");
      ttt.equal(Object.isFrozen(copies[0].get("array")), false, "array copy is not frozen at first");

      commit();
      ttt.equal(Object.isFrozen(copies[0]), true, "copy is frozen after commit");
      ttt.equal(Object.isFrozen(copies[0].get("array")), true, "array copy is frozen after commit");
    });

    tt.test("mutate value returned from Map.values()", async (ttt) => {
      const target = deepFreeze(new Map([
        ["map", new Map()],
        [10, 10],
      ]));
      const { proxy, copies, listeners, commit } = newProxy(target);

      const values = [...proxy.values()];
      ttt.deepEqual(toNative(values), [new Map(), 10], "Map.values works as expected");

      values[0].set("k", "v");
      ttt.deepEqual(toNative(proxy.get("map")), new Map([["k", "v"]]), "change reflects in proxy");
      ttt.deepEqual(listeners.length, 2, "registers a commit listener for each proxy");
      ttt.deepEqual(toNative(copies), [new Map([["map", new Map([["k", "v"]])], [10, 10]])], "make a copy when mutate an map value");
      ttt.equal(Object.isFrozen(copies[0]), false, "copy is not frozen at first");
      ttt.equal(Object.isFrozen(copies[0].get("map")), false, "map copy is not frozen at first");

      commit();
      ttt.equal(Object.isFrozen(copies[0]), true, "copy is frozen after commit");
      ttt.equal(Object.isFrozen(copies[0].get("map")), true, "map copy is frozen after commit");
    });
  });
});
