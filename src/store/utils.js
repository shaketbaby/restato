
export function copy(value) {
  if (Array.isArray(value)) {
    return value.slice();
  }

  if (value instanceof Map) {
    return new Map(value);
  }

  if (value instanceof Set) {
    return new Set(value);
  }

  const proto = Object.getPrototypeOf(value);
  return Object.assign(Object.create(proto), value);
}

export function inherit(base, descriptors) {
  const properties = Reflect.ownKeys(descriptors).reduce(
    function (desc, key) {
      const value = descriptors[key];
      const isFn = typeof (value) === "function";
      desc[key] = isFn ? { value } : value;
      return desc;
    },
    {}
  );
  return Object.create(base, properties);
}

export function needsProxy(value) {
  switch (getTypeOf(value)) {
    case "object":
    case "array":
    case "map":
      return true;
  }
  return false;
}

export function getTypeOf(value) {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  if (value instanceof Date) {
    return "date";
  }
  if (value instanceof Number) {
    return "number";
  }
  if (value instanceof String) {
    return "string";
  }
  if (value instanceof Boolean) {
    return "boolean";
  }
  if (value instanceof Map) {
    return "map";
  }
  if (value instanceof Set) {
    return "set";
  }
  return typeof(value);
}
