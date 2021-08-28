import test from "tape";

import { getTypeOf } from "./utils.js";
import { createProxy } from "./proxy.js";

test("createProxy", async (t) => {
  function newProxy(target) {
    const copies = [];
    const listeners = [];

    const onCopied = (copy) => copies.push(copy);
    const whenComitted = (listener) => listeners.push(listener);
    const { proxy } = createProxy(target, onCopied, whenComitted);

    return { proxy, copies, commit: () => listeners.forEach(l => l()) };
  }

  for (const v of [0, 1n, true, "", null, undefined, Symbol("symbol"), () => {}]) {
    const type = v === null ? 'null' : typeof(v);
    t.equal(newProxy(v).proxy, v, `returns "${type}" value as is`);
  }

  t.test("for Object", async (tt) => {
    tt.test("returns a proxy", async (ttt) => {
      const target = { key: "value", nested: { k: "v" } };
      const { proxy } = newProxy(target);
      ttt.deepEqual(proxy, target);
      ttt.notEqual(proxy, target);
    });

    tt.test("returns 'undefined' for non-exist prop", async (ttt) => {
      const { proxy } = newProxy({});
      ttt.equal(proxy.nonExist, undefined);
    });

    tt.test("mutates proxy only", async (ttt) => {
      const target = {};
      const { proxy } = newProxy(target);

      proxy.key = "value";
      ttt.equal(proxy.key, "value");
      ttt.equal(target.key, undefined);

      // do not touch nested object
      const obj = {};
      proxy.obj = obj;
      proxy.obj.nested = true;
      ttt.deepEqual(obj, {});
      ttt.deepEqual(target, {});
      ttt.deepEqual(proxy.obj, { nested: true });
    });

    tt.test("should only copy on write when needed", async (ttt) => {
      const { proxy, copies, commit } = newProxy({ leaf: 0, branch: {} });

      ttt.deepEqual(copies, []);

      // trigger a copy on first change
      proxy.leaf = "leaf";
      ttt.deepEqual(copies, [{ leaf: "leaf", branch: {} }]);
      ttt.deepEqual(proxy, copies[copies.length - 1]);

      // no copy when update sampe prop
      // but changes reflected in the latest copy
      proxy.leaf = 1;
      ttt.deepEqual(copies, [{ leaf: 1, branch: {} }]);
      ttt.deepEqual(proxy, copies[copies.length - 1]);

      // no copy when update another prop
      // but changes reflected in the latest copy
      proxy.branch.subBranch = {};
      ttt.deepEqual(copies, [{ leaf: 1, branch: { subBranch: {} } }]);
      ttt.deepEqual(proxy, copies[copies.length - 1]);

      proxy.branch2 = {};
      ttt.deepEqual(copies, [{ leaf: 1, branch: { subBranch: {} }, branch2: {} }]);
      ttt.deepEqual(proxy, copies[copies.length - 1]);

      // mimic changes are commited
      commit();

      // trigger a copy of each parent when updates nested prop
      proxy.branch.subBranch.leaf = true;
      ttt.deepEqual(copies, [
        { leaf: 1, branch: { subBranch: {} }, branch2: {} },
        { leaf: 1, branch: { subBranch: { leaf: true } }, branch2: {} }
      ]);
      ttt.deepEqual(proxy, copies[copies.length - 1]);

      // no copy when update prop of a different branch
      // but changes reflected in the latest copy
      proxy.branch2.leaf = 1;
      ttt.deepEqual(copies, [
        { leaf: 1, branch: { subBranch: {} }, branch2: {} },
        { leaf: 1, branch: { subBranch: { leaf: true } }, branch2: { leaf: 1 } }
      ]);
      ttt.deepEqual(proxy, copies[copies.length - 1]);

      // no copy when delete a branch
      // but changes reflected in the latest copy
      delete proxy.branch2;
      ttt.deepEqual(copies, [
        { leaf: 1, branch: { subBranch: {} }, branch2: {} },
        { leaf: 1, branch: { subBranch: { leaf: true } } }
      ]);
      ttt.deepEqual(proxy, copies[copies.length - 1]);

      // mimic another commit
      commit();

      // trigger a copy when delete a prop
      delete proxy.leaf;
      ttt.deepEqual(copies, [
        { leaf: 1, branch: { subBranch: {} }, branch2: {} },
        { leaf: 1, branch: { subBranch: { leaf: true } } },
        { branch: { subBranch: { leaf: true } } },
      ]);
      ttt.deepEqual(proxy, copies[copies.length - 1]);
    });

    tt.test("revokes old proxy on delete", async (ttt) => {
      const { proxy } = newProxy({ branch: { key: true } });
      const { branch } = proxy;

      // do not create new proxy on every access
      ttt.equal(branch, proxy.branch);

      delete proxy.branch;

      ttt.equal(proxy.branch, undefined);
      ttt.throws(() => branch.key, /Cannot perform 'get' on a proxy that has been revoked/);
    });

    tt.test("revokes old proxy only when set prop to a different type", async (ttt) => {
      const { proxy } = newProxy({ branch: {} });
      const { branch } = proxy;

      // do not revoke when type doesn't change
      proxy.branch = { new: true };
      ttt.deepEqual(branch, { new: true });

      // reovkes when type is different
      proxy.branch = [];
      ttt.throws(() => branch.foo, /Cannot perform 'get' on a proxy that has been revoked/);
    });
  });

  t.test("for Array", async function(tt) {
    const target = [{}, "string"];
    const { proxy, copies, commit } = newProxy(target);
    tt.notEqual(proxy, target, "can create proxy");
    tt.deepEqual(proxy, target, "has the same content");
    tt.deepEqual(proxy[0], {}, "can access object item");
    tt.deepEqual(proxy[1], "string", "can access string item");

    proxy.push([]);
    tt.deepEqual(proxy[2], [], "can push a new array item");
    tt.deepEqual(copies, [[{}, "string", []]], "create a copy");
    tt.deepEqual(target, [{}, "string"], "doesn't change target");

    proxy[0].k = "v";
    tt.deepEqual(proxy[0], { k: "v" }, "can mutate object item");
    tt.deepEqual(target, [{}, "string"], "doesn't change target");
    tt.deepEqual(copies, [[{ k: "v" }, "string", []]], "mutate current copy");
    tt.deepEqual(proxy, copies[copies.length - 1], "proxy reflects the latest copy");

    commit();
    tt.comment("after changes are committed");

    proxy[2].unshift(10, { doc: {} }, ["Jan", "Jan", "April"]);
    proxy[2][0] = 100;

    const nestedObj = proxy[2][1];
    const { doc }= nestedObj;

    nestedObj.doc = { foo: "bar" };

    tt.equal(doc.foo, "bar", "prop proxy reflects latest value");

    const nestedArr = proxy[2][2];
    nestedArr.splice(1, 1, "Feb", "Mar");

    const expected = [
      [{ k: "v" }, "string", []],
      [{ k: "v" }, "string", [100, { doc: { foo: "bar" } }, ["Jan", "Feb", "Mar", "April"]]],
    ];
    tt.deepEqual(copies, expected, "makes a new copy with changes");
    tt.deepEqual(proxy, copies[copies.length - 1], "proxy reflects the latest copy");

    tt.equal(proxy.includes("string"), true, "can call includes");
    tt.equal(nestedArr.find(item => item.startsWith("F")), "Feb", "can call find");
    tt.deepEqual(proxy[2].map(getTypeOf), ["number", "object", "array"], "can map");

    proxy[2][1] = true;
    delete proxy[2][2];
    tt.throws(() => doc.foo, /Cannot perform 'get' on a proxy that has been revoked/);
    tt.throws(() => nestedObj.doc, /Cannot perform 'get' on a proxy that has been revoked/);
    tt.throws(() => nestedArr[0], /Cannot perform 'get' on a proxy that has been revoked/);
  });

  t.test("for Map", async function(tt) {
    const target = new Map();
    target.set("object", {});
    target.set("string", "string");

    const { proxy, copies, commit } = newProxy(target);
    tt.notEqual(proxy, target, "can create proxy");
    tt.equal(getTypeOf(proxy), "map", "is instance of Map");
    tt.deepEqual(new Map(proxy), target, "has the same entries");
    tt.deepEqual(proxy.get("object"), {}, "can access array entry");
    tt.deepEqual(proxy.get("string"), "string", "can access string entry");
    tt.deepEqual(copies, [], "do not copy for read access");

    proxy.set("array", []);
    tt.equal(proxy.size, 3, "has correct size");
    tt.deepEqual(proxy.get("array"), [], "can set a new array entry");
    tt.deepEqual(target, new Map([["object", {}], ["string", "string"]]), "doesn't change target");
    tt.deepEqual(copies, [new Map([["object", {}], ["string", "string"], ["array", []]])], "create a copy");

    proxy.get("object").k = "v";
    tt.deepEqual(proxy.get("object"), { k: "v" }, "can mutate object entry");
    tt.deepEqual(target, new Map([["object", {}], ["string", "string"]]), "doesn't change target");
    tt.deepEqual(copies, [new Map([["object", { k: "v" }], ["string", "string"], ["array", []]])], "create a copy");
    tt.deepEqual(new Map(proxy), copies[copies.length - 1], "proxy reflects the latest copy");

    commit();
    tt.comment("after changes are committed");

    proxy.get("array").unshift(10, { map: new Map() }, ["Jan", "Jan", "April"]);
    proxy.get("array")[0] = 100;

    const nestedObj = proxy.get("array")[1];
    const { map }= nestedObj;

    nestedObj.map = new Map(Object.entries({ foo: "bar" }));

    tt.equal(map.get("foo"), "bar", "prop proxy reflects latest value");

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
    tt.deepEqual(copies, expected, "makes a new copy with changes");
    tt.deepEqual([...nestedObj.map.values()], ["bar"], "return correct values");
    tt.deepEqual(Array.from(proxy.keys()), ["object", "string", "array"], "return correct keys");
    tt.deepEqual(proxy.get("array").map(getTypeOf), ["number", "object", "array"], "can map nested array");

    const arrProxy = proxy.get("array");
    arrProxy[1].map.delete("foo");
    tt.equal(map.has("foo"), false, "has return false after key is deleted");

    arrProxy[1].map = {};
    tt.throws(() => map.size, /Cannot perform 'get' on a proxy that has been revoked/);

    proxy.delete("array");
    tt.throws(() => arrProxy[0], /Cannot perform 'get' on a proxy that has been revoked/);

    commit();

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
    tt.deepEqual(forEachActual, forEachExpected, "forEach works as expected");

    proxy.values().next().value.k = "value";
    tt.deepEqual(copies[2].get("object"), { k: "value" }, "makes a copy when modify value return from valus()");
  });
});
