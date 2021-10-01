import test from "tape";
import React from 'react';
import globalJsDom from 'global-jsdom';
import { render, fireEvent } from '@testing-library/react';

import { dispatch, useSelector, store } from "./react.js";

test("ReactStore", async (t) => {
  const selector = (state) => state.count;

  function Counter() {
    const count = useSelector(selector);
    const increase = () => dispatch((state) => { state.count++; });
    return React.createElement("button", { onClick: increase }, count);
  }

  const cleanup = globalJsDom();

  // initialise store
  store.setState({ count: 0 });

  const { queryByRole, queryByText, findByText } = render(
    React.createElement(Counter)
  );
  const button = queryByRole("button");

  t.equal(queryByText("0"), button);

  fireEvent.click(button);
  t.equal(await findByText("1"), button);

  t.end();
  cleanup();
});
