import test from "tape";
import React from 'react';
import globalJsDom from 'global-jsdom';
import { render, fireEvent } from '@testing-library/react';

import { dispatch, useSelector } from "./react.js";

test("ReactStore", async (t) => {
  function Counter() {
    const count = useSelector((state) => state.count);
    const increase = () => dispatch((state) => { state.count++; });
    return React.createElement("button", { onClick: increase }, count);
  }

  const cleanup = globalJsDom();

  // initialise store
  dispatch((state) => state.count = 0);

  const { queryByRole, findByText } = render(React.createElement(Counter));
  const button = queryByRole("button");

  t.equal(await findByText("0"), button);

  fireEvent.click(button);
  t.equal(await findByText("1"), button);

  t.end();
  cleanup();
});
