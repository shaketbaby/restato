import test from "tape";

import { createProxy } from "./proxy.js";

test("createProxy", async (t) => {
  function newProxy(target) {
    let latest = target;
    const copies = [];
    const listeners = [];

    const getLatest = () => latest;
    const onCopied = (copy) => copies.push(latest = copy);
    const whenComitted = (listener) => listeners.push(listener);
    const { proxy } = createProxy(target, onCopied, whenComitted);

    return { proxy, getLatest, copies, commit: () => listeners.forEach(l => l()) };
  }

  for (const v of [0, 1n, true, "", null, undefined, Symbol("symbol")]) {
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
});
