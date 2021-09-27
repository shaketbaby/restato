import test from "tape";

import { deepFreeze, getTypeOf, noop } from "./utils.js";
import { createProxy } from "./proxy.js";

test("createProxy", async (t) => {
  function newProxy(target) {
    let latest = target;
    const copies = [];
    const listeners = [];
    const { proxy, setTarget, commit } = createProxy(target, {
      detach: noop,
      refresh: () => setTarget(latest),
      onCopied: (copy) => {
        listeners.push(commit);
        copies.push(latest = copy);
      },
    });
    return { proxy, copies, listeners, commit() {
      listeners.forEach(l => l());
      listeners.length = 0; // empty listeners array
    } };
  }

  // tape.deepEqual doesn't like the Map proxy
  // convert to native Map before comparison
  function toNative(proxy) {
    switch (getTypeOf(proxy)) {
      case "array":
        return proxy.map(toNative);
      case "date":
        return new Date(proxy.getTime());
      case "map":
        const map = new Map();
        proxy.forEach((value, key) => map.set(key, toNative(value)));
        return map;
      case "set":
        const set = new Set();
        proxy.forEach((value) => set.add(toNative(value)));
        return set;
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

      proxy.newProp = null;
      ttt.equal(proxy.newProp, null, "can set prop to null");

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
      ttt.deepEqual(listeners.length, 1, "does not register another commit listener when mutate nested object");

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
      ttt.deepEqual(listeners.length, 1, "registers another commit listener when mutate again after commit");

      proxy.object = { another: true };
      ttt.deepEqual(objectProxy, { prop: 100, newProp: true }, "existing nested proxy points to original value when prop is set to a new value of same type");

      proxy.object = [];
      ttt.deepEqual(objectProxy, { prop: 100, newProp: true }, "existing nested proxy points to original value when prop is set to a value of different type");

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
      ttt.deepEqual(listeners.length, 1, "does not register another commit listener when mutate nested array");

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
      ttt.deepEqual(listeners.length, 1, "registers another commit listener after commit");

      proxy.array = ["another"];
      ttt.deepEqual(arrayProxy, [100, true], "existing nested proxy points to original value when prop is set to a new value of same type");

      proxy.array = { length: 1 };
      ttt.deepEqual(arrayProxy, [100, true], "existing nested proxy is pointing to original value when prop is set to a value of different type");

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
      ttt.throws(() => lastMapCopy.clear(), /Can not mutate frozen Map/, "can not mutate frozen map");

      const mapProxy = proxy.map;

      mapProxy.set("prop", 100);
      ttt.notEqual(lastCopy.map, lastMapCopy, "make a copy for nested map")
      ttt.equal(copies[0], lastCopy, "mutate root copy in place when mutate nested map");
      ttt.deepEqual(toNative(copies), [{ map: new Map([["prop", 100]]) }], "copy relfects latest changes");
      ttt.deepEqual(listeners.length, 1, "does not register new commit listener when mutate nested map");

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
      ttt.deepEqual(listeners.length, 1, "registers another commit listener when mutate again");

      proxy.map = new Map([["another", true]]);
      ttt.deepEqual(toNative(mapProxy), new Map([["prop", 100], ["newProp", true]]), "existing nested proxy points to original value when prop is set to a new value of same type");

      proxy.map = { size: 1 };
      ttt.equal(mapProxy.has("another"), false, "existing nested proxy is pointing to original value when prop is set to a value of different type");

      ttt.deepEqual(target, {}, "target is left untouched");
    });

    tt.test("delete properties", async (ttt) => {
      const target = deepFreeze({ num: 1, array: [{ map: new Map() }] });
      const { proxy, copies, listeners, commit } = newProxy(target);

      const arrayProxy = proxy.array;
      const objectProxy = arrayProxy[0];
      const mapProxy = proxy.array[0].map;

      delete objectProxy.map;
      ttt.deepEqual(objectProxy, {}, "can delete a prop from nested object");
      ttt.deepEqual(mapProxy.size, 0, "existing nested proxy still works after prop is deleted");
      ttt.deepEqual(listeners.length, 1, "registers a commit listener on first delete");
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
      ttt.deepEqual(copies, [{ array: [{}] }, {}], "make a copy again on first delete after commit");
      ttt.deepEqual(listeners.length, 1, "registers a commit listener on first delete after commit");

      ttt.deepEqual(toNative(target), { num: 1, array: [{ map: new Map() }] }, "target is left untouched");
    });

    tt.test("mutate value returned from Object.values()", async (ttt) => {
      const target = deepFreeze({ num: 1, object: {} });
      const { proxy, copies, listeners, commit } = newProxy(target);

      const values = Object.values(proxy);
      ttt.deepEqual(values, [1, {}], "can get object values");

      values[1].prop = "value";
      ttt.deepEqual(listeners.length, 1, "registers commit listener when mutate a value");
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
      ttt.deepEqual(listeners.length, 1, "registers a commit listener when mutate a value");
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
      const now = Date.now() + 1000;
      const target = deepFreeze({
        object: {
          wontExist: { now },
          typeWillChange: { now },
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
      ttt.deepEqual(objectProxy.wontExist, { now }, "returns original value for removed child prop");
      ttt.equal(wontExistProxy.now, now, "old proxy of removed child prop is pointing to old prop");

      ttt.deepEqual(typeWillChangeProxy, { now }, "old proxy of type changing child is pointing to old value");
      ttt.deepEqual(objectProxy.typeWillChange, { now }, "returns original value for type changing child");

      ttt.deepEqual(valueWillChangeProxy, { k: "v" }, "old proxy of value changing child reflects old value");
      ttt.deepEqual(objectProxy.valueWillChange, { k: "v" }, "returns old value for value changing child");

      ttt.deepEqual(objectProxy.notTouchedTypeWillChange, {}, "returns old value for not touched child");
    });

    tt.test("reassign a Set prop", async (ttt) => {
      const now = Date.now();
      const obj = { now };
      const arr = [now];
      const target = deepFreeze({ set: new Set([obj, arr]) });

      const { proxy } = newProxy(target);
      const [objProxy, arrayProxy] = [...proxy.set.values()];

      proxy.set = new Set([{}, arr]);
      ttt.equal(objProxy.now, now, "old proxy of removed set value still points to original value");
      ttt.deepEqual(arrayProxy, [now], "old proxy of non-removed set value still points to original value");
    });
  });

  t.test("for Array", async (tt) => {
    tt.test("basic operations", async (ttt) => {
      const target = deepFreeze([{}, "string"]);
      const { proxy, copies, listeners, commit } = newProxy(target);
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
      ttt.deepEqual(new Map(mapProxy.entries()), new Map(), "can mutate map item");
    });

    tt.test("mutate value returned from Array.map()", async (ttt) => {
      const target = deepFreeze([new Map(), 10]);
      const { proxy, copies, listeners, commit } = newProxy(target);

      const values = proxy.map(v => v);
      ttt.deepEqual(toNative(values), [new Map(), 10], "Array.map works as expected");

      values[0].set("k", "v");
      ttt.deepEqual(toNative(proxy[0]), new Map([["k", "v"]]), "change reflects in proxy");
      ttt.deepEqual(listeners.length, 1, "registers a commit listener when mutate a map value");
      ttt.deepEqual(toNative(copies), [[new Map([["k", "v"]]), 10]], "make a copy when mutate a map value");
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
      const { map } = nestedObj;

      nestedObj.map = new Map(Object.entries({ foo: "bar" }));
      ttt.equal(map.has("foo"), false, "prop proxy ref points to original prop");

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
        function (value, key, p) {
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
      ttt.deepEqual(listeners.length, 1, "registers a commit listener when mutate an object value");
      ttt.deepEqual(toNative(copies), [new Map([["object", { k: "new" }], ["string", "string"]])], "make a copy when mutate an object value");
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
      ttt.deepEqual(listeners.length, 1, "registers a commit listener when mutate an array value");
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
      ttt.deepEqual(listeners.length, 1, "registers a commit listener when mutate an map value");
      ttt.deepEqual(toNative(copies), [new Map([["map", new Map([["k", "v"]])], [10, 10]])], "make a copy when mutate an map value");
      ttt.equal(Object.isFrozen(copies[0]), false, "copy is not frozen at first");
      ttt.equal(Object.isFrozen(copies[0].get("map")), false, "map copy is not frozen at first");

      commit();
      ttt.equal(Object.isFrozen(copies[0]), true, "copy is frozen after commit");
      ttt.equal(Object.isFrozen(copies[0].get("map")), true, "map copy is frozen after commit");
    });
  });

  t.test("for Set", async (tt) => {
    tt.test("can create proxy", async (ttt) => {
      const target = deepFreeze(new Set([1, { obj: true }, ["array"],]));
      const { proxy, copies, listeners } = newProxy(target);
      ttt.notEqual(proxy, target, "returns a proxy");
      ttt.equal(proxy instanceof Set, true, "is considered a Set");
      ttt.deepEqual(toNative(proxy), toNative(target), "proxy and target have same content");
      ttt.equal(proxy.size, 3, "has correct size");
      ttt.deepEqual(copies, [], "does not make copy for reads");
      ttt.deepEqual(listeners, [], "does not register commit listener for reads");
    });

    tt.test("has works", async (ttt) => {
      const target = deepFreeze(new Set([1, { obj: true }, ["array"], new Map(), new Set(), new Date()]));
      const { proxy, copies, listeners } = newProxy(target);

      for (const v of target) {
        ttt.equal(proxy.has(v), true, `returns true for existing ${getTypeOf(v)} value`);
      }

      for (const v of [2, {}, [], new Map(), new Set(), new Date()]) {
        ttt.equal(proxy.has(v), false, `returns false for non-existing ${getTypeOf(v)} value`);
      }

      ttt.deepEqual(copies, [], "does not make copy for calling has");
      ttt.deepEqual(listeners, [], "does not register commit listener for calling has");
    });

    tt.test("add works", async (ttt) => {
      const target = deepFreeze(new Set([]));
      const { proxy, copies, listeners, commit } = newProxy(target);

      ttt.equal(proxy.add(1), proxy, "can add new number and returns proxy");
      ttt.equal(proxy.size, 1, "size increases after adding new value");
      ttt.equal(proxy.has(1), true, "has returns true for newly added value");
      ttt.deepEqual(toNative(copies), [new Set([1])], "makes a copy on first add");
      ttt.deepEqual(Object.isFrozen(copies[0]), false, "new copy is not frozen at first");
      ttt.deepEqual(listeners.length, 1, "registers a new commit listener on first add");

      ttt.equal(proxy.add(1), proxy, "can add existing value and returns proxy");
      ttt.equal(proxy.size, 1, "size does not increase after adding existing value");
      ttt.deepEqual(toNative(copies), [new Set([1])], "does not makes a copy on adding existing value");
      ttt.deepEqual(listeners.length, 1, "does not register a new commit listener on adding existing value");

      const arr = [];
      ttt.equal(proxy.add(arr), proxy, "can add new array and returns proxy");
      ttt.deepEqual(toNative(copies), [new Set([1, arr])], "mutates latest copy on subsequent add");
      ttt.deepEqual(listeners.length, 1, "does not register a new commit listener on subsequent add");
      ttt.deepEqual(Object.isFrozen(arr), true, "newly added array is frozen after being added");

      commit();
      ttt.deepEqual(Object.isFrozen(copies[0]), true, "new copy is frozen after commit");

      const obj = {};
      ttt.equal(proxy.add(obj), proxy, "can add new object and returns proxy");
      ttt.deepEqual(listeners.length, 1, "registers a new commit listener on first add after commit");
      ttt.deepEqual(toNative(copies), [new Set([1, arr]), new Set([1, arr, obj])], "makes a copy on first add after commit");
      ttt.deepEqual(Object.isFrozen(obj), true, "newly added object is frozen after being added");

      const date = new Date();
      ttt.equal(proxy.add(date), proxy, "can add new date and returns proxy");
      ttt.equal(proxy.has(date), false, "has returns false for original date reference");
      ttt.deepEqual(toNative(copies), [new Set([1, arr]), new Set([1, arr, obj, date])], "mutates latest copy on subsequent add after commit");
      ttt.deepEqual(listeners.length, 1, "does not register a new commit listener on subsequent add after commit");
      ttt.deepEqual(Object.isFrozen(date), true, "newly added date is frozen after being added after commit");
      ttt.throws(() => date.setTime(-1), /Can not mutate frozen Date/, "original date can not be mutated anymore");
      const frozenDate = [...proxy.values()][proxy.size - 1];
      ttt.deepEqual(toNative(frozenDate), date, "a frozen version is added");

      const map = new Map([["now", Date.now()]]);
      ttt.equal(proxy.add(map), proxy, "can add new map and returns proxy");
      ttt.equal(proxy.has(map), false, "has returns false for original map reference");
      ttt.deepEqual(Object.isFrozen(map), true, "original map should be frozen");
      ttt.throws(() => map.set("now", -1), /Can not mutate frozen Map/, "original map can not be mutated anymore");
      const frozenMap = [...proxy.values()][proxy.size - 1];
      ttt.deepEqual(toNative(frozenMap), new Map(Map.prototype.entries.call(map)), "a frozen version is added");

      const set = new Set([Date.now()]);
      ttt.equal(proxy.add(set), proxy, "can add new set and returns proxy");
      ttt.equal(proxy.has(set), false, "has returns false for original set reference");
      ttt.deepEqual(Object.isFrozen(set), true, "original set should be frozen");
      ttt.throws(() => set.add({}), /Can not mutate frozen Set/, "original set can not be mutated anymore");
      const frozenSet = [...proxy.values()][proxy.size - 1];
      ttt.deepEqual(toNative(frozenSet), new Set(Set.prototype.values.call(set)), "a frozen version is added");

      proxy.add(null);
      ttt.equal(proxy.has(null), true, "can add null as value");

      ttt.deepEqual(toNative(target), new Set(), "target is left untouched");
    });

    tt.test("delete works", async (ttt) => {
      const n = Date.now();
      const arr = ["array"];
      const obj = { obj: true };
      const map = deepFreeze(new Map());
      const set = deepFreeze(new Set());
      const date = deepFreeze(new Date());
      const target = deepFreeze(new Set([n, arr, obj, map, set, date]));
      const { proxy, copies, listeners, commit } = newProxy(target);

      ttt.equal(proxy.delete("unknown"), false, "returns false when delete unknown value");
      ttt.equal(proxy.size, 6, "size does not change when delete unknown value");
      ttt.deepEqual(listeners, [], "does not register commit listener when delete unknown value");
      ttt.deepEqual(copies, [], "does not make copy when delete unknown value");

      ttt.equal(proxy.delete(date), true, "returns true when delete Date");
      ttt.equal(proxy.size, 5, "size decreases when delete a known value");
      ttt.equal(proxy.has(date), false, "has return false for the deleted value");
      ttt.deepEqual(listeners.length, 1, "registers a commit listener when delete known value the first time");
      ttt.deepEqual(toNative(copies), toNative([new Set([n, arr, obj, map, set])]), "make a copy when delete known value the first time");
      ttt.equal(Object.isFrozen(copies[0]), false, "new copy is not frozen at first");

      ttt.equal(proxy.delete(n), true, "returns true when delete a number");
      ttt.deepEqual(listeners.length, 1, "does not register commit listener on subsequent delete");
      ttt.deepEqual(toNative(copies), toNative([new Set([arr, obj, map, set])]), "mutates latest copy on subsequent delete");

      commit();
      ttt.equal(Object.isFrozen(copies[0]), true, "copy is frozen after commit");

      ttt.equal(proxy.delete(set), true, "returns true when delete a Set");
      ttt.deepEqual(listeners.length, 1, "registers a commit listener on first delete after commit");
      ttt.deepEqual(toNative(copies), toNative([
        new Set([arr, obj, map, set]),
        new Set([arr, obj, map])
      ]), "make a copy on first delete after commit");
      ttt.equal(Object.isFrozen(copies[1]), false, "new copy is not frozen at first");

      ttt.equal(proxy.delete(map), true, "returns true when delete a Map");
      ttt.deepEqual(listeners.length, 1, "does not register commit listener on subsequent delete after commit");
      ttt.deepEqual(toNative(copies), toNative([
        new Set([arr, obj, map, set]),
        new Set([arr, obj])
      ]), "mutates latest copy on subsequent delete after commit");

      ttt.equal(proxy.delete(obj), true, "returns true when delete an object");
      ttt.equal(proxy.delete(arr), true, "returns true when delete an array");

      ttt.deepEqual(toNative(target), toNative(new Set([n, arr, obj, map, set, date])), "target is left untouched");
    });

    tt.test("clear works", async (ttt) => {
      const target = deepFreeze(new Set([1, "2", {}]));
      const { proxy, copies, listeners, commit } = newProxy(target);
      ttt.equal(proxy.clear(), undefined, "can clear Set");
      ttt.equal(proxy.size, 0, "size becomes 0 after clear");
      ttt.deepEqual(toNative(copies), [new Set()], "makes a new copy on clear");
      ttt.deepEqual(listeners.length, 1, "registers a commit listener on clear");
      ttt.equal(Object.isFrozen(copies[0]), false, "new copy is not frzoen at first");

      commit();
      ttt.equal(Object.isFrozen(copies[0]), true, "new copy is frzoen after commit");

      ttt.equal(proxy.clear(), undefined, "can clear an empty Set");
      ttt.deepEqual(toNative(copies), [new Set()], "does not make a new copy on clear empty set");
      ttt.deepEqual(listeners.length, 0, "registers a commit listener on clear empty set");
    });

    tt.test("mutate value returned from values()", async (ttt) => {
      const now = Date.now();
      const target = deepFreeze(new Set([{ now }, [now]]));
      const { proxy, copies, listeners } = newProxy(target);

      const values = [...proxy.values()];
      ttt.deepEqual(values, [{ now }, [now]], "values returned are correct");

      values[0].now = 1;
      ttt.deepEqual(toNative(copies), [new Set([{ now: 1 }, [now]])], "makes a copy when mutate value");
      ttt.deepEqual(listeners.length, 1, "registers a commit listner when mutate value");
      ttt.deepEqual(toNative(proxy), toNative(copies[0]), "proxy reflects latest copy");
    });

    tt.test("mutate value returned from keys()", async (ttt) => {
      const now = Date.now();
      const target = deepFreeze(new Set([new Set([[now]])]));
      const { proxy, copies, listeners } = newProxy(target);

      const keys = [...proxy.keys()];
      ttt.deepEqual(toNative(keys), [new Set([[now]])], "values returned are correct");

      keys[0].keys().next().value[0] = 1;
      ttt.deepEqual(toNative(copies), [new Set([new Set([[1]])])], "makes a copy when mutate value");
      ttt.deepEqual(listeners.length, 1, "registers a commit listner when mutate value");
      ttt.deepEqual(toNative(proxy), toNative(copies[0]), "proxy reflects latest copy");
    });

    tt.test("mutate value returned from entries()", async (ttt) => {
      const now = Date.now();
      const target = deepFreeze(new Set([new Map([["now", now]])]));
      const { proxy, copies, listeners } = newProxy(target);

      const values = [...proxy.entries()];
      ttt.deepEqual(toNative(values), [[new Map([["now", now]]), new Map([["now", now]])]], "entries returned are correct");
      ttt.equal(values[0][0], values[0][1], "value and key are same in each entry");

      values[0][0].set("now", 1);
      ttt.deepEqual(toNative(copies), [new Set([new Map([["now", 1]])])], "makes a copy when mutate value");
      ttt.deepEqual(listeners.length, 1, "registers a commit listner when mutate value");
      ttt.deepEqual(toNative(proxy), toNative(copies[0]), "proxy reflects latest copy");
    });
  });

  t.test("for Date", async (tt) => {
    const now = Date.now();
    const expectedDate = new Date(now);
    const target = deepFreeze(new Date(now));
    const { proxy, copies, listeners, commit } = newProxy(target);

    Reflect.ownKeys(Date.prototype).forEach(key => {
      if (!key.startsWith?.("set")) {
        switch(key) {
          case Symbol.toPrimitive:
            tt.equal(proxy[key]("number"), expectedDate[key]("number"), `${key.toString()} works as expected`);
            break;
          case "constructor":
            tt.deepEqual(new proxy[key](now), new Date(now), `${key} works as expected`);
            break;
          default:
            tt.equal(proxy[key](), expectedDate[key](), `${key} works as expected`);
        }
      }
    });

    proxy.setFullYear(2000);
    expectedDate.setFullYear(2000);
    tt.equal(proxy.getTime(), expectedDate.getTime(), "setFullYear works as expected");
    tt.equal(listeners.length, 1, "registers a commit listener on first set");
    tt.deepEqual(toNative(copies), [expectedDate], "makes a copy on first set");
    tt.equal(Object.isFrozen(copies[0]), false, "new copy is not frozen at first");

    proxy.setTime(2000);
    expectedDate.setTime(2000);
    tt.equal(proxy.getTime(), expectedDate.getTime(), "setTime works as expected");
    tt.deepEqual(toNative(copies), [expectedDate], "mutates latest copy on subsequent set");
    tt.equal(listeners.length, 1, "does not register new commit listener on subsequent set");

    commit();
    tt.equal(Object.isFrozen(copies[0]), true, "copy is frozen after commit");
    tt.equal(copies[0].getTime(), expectedDate.getTime(), "can still get from frozen date");
    tt.throws(() => copies[0].setDate(1), /Can not mutate frozen Date/, "can not set frozen date");
  });

  t.test("attach/detach to/from Object", async (tt) => {
    const now = Date.now() + 1000;
    const target = deepFreeze({ set: new Set([now]) });
    const { proxy, copies, commit } = newProxy(target);

    let setProxy = proxy.set;

    proxy.set = setProxy;
    tt.deepEqual(copies, [], "ignores when trying to set proxy to same prop");

    proxy.set2 = setProxy;
    tt.deepEqual(toNative(copies), [{ set: new Set([now]), set2: new Set([now]) }], "can set proxy as value of a new prop");
    tt.notEqual(proxy.set2, proxy.set, "new prop and old prop have different proxies");
    tt.equal(proxy.set2, setProxy, "old proxy ref is same as new prop");

    setProxy.add(0);
    tt.deepEqual(toNative(proxy.set), new Set([now]), "changes made using proxy ref does not affect old prop");
    tt.deepEqual(toNative(proxy.set2), new Set([now, 0]), "changes made using proxy ref reflects in new prop");

    setProxy = proxy.set;
    proxy.obj = { nested: { arr: [proxy.set] } };
    const expectedCopies = [
      {
        set: new Set([now]),
        set2: new Set([now, 0]),
        obj: { nested: { arr: [new Set([now])] } }
      }
    ];
    tt.equal(proxy.obj.nested.arr[0], setProxy, "proxy ref to nested prop points to newly adopted prop");
    tt.deepEqual(toNative(copies), expectedCopies, "can set proxy as value of a nested prop");

    commit();
    tt.equal(Object.isFrozen(copies[0].obj.nested.arr), true);
  });

  t.test("attach/detach to/from Set", async (tt) => {
    const now = Date.now() + 1000;
    const target = deepFreeze(new Set([{ arr: [now] }]));
    const { proxy, copies } = newProxy(target);

    const objProxy = proxy.values().next().value;
    proxy.add(objProxy);
    tt.deepEqual(copies, [], "ignores when trying to add proxy back");

    const arrProxy = objProxy.arr;
    proxy.add(arrProxy);
    tt.deepEqual(toNative(copies), [new Set([{ arr: [now] }, [now]])], "can add proxy as new value");

    arrProxy[0] = 0;
    const proxies = [...proxy.values()];
    tt.deepEqual(proxies[0].arr, [now], "changes made using proxy ref does not affect old value");
    tt.deepEqual(proxies[1], [0], "changes made using proxy ref reflects in new value");
    let expectedCopies = [
      new Set([{ arr: [now] }, [now]]),
      new Set([{ arr: [now] }, [0]])
    ];
    tt.deepEqual(toNative(copies), expectedCopies, "changes are refected in copies");

    proxy.add({ nested: { arr: arrProxy } });
    expectedCopies = [
      new Set([{ arr: [now] }, [now]]),
      new Set([{ arr: [now] }, [0]]),
      new Set([{ arr: [now] }, [0], { nested: { arr: [0] } }])
    ];
    tt.deepEqual(toNative(copies), expectedCopies, "can add proxy as value of a nested prop");
  });
});
