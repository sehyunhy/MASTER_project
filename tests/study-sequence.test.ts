import assert from "node:assert/strict";
import test from "node:test";
import { orderForEnrollment, STUDY_ORDERS } from "../lib/study/sequence";

test("five-person blocks contain every order and rotate the extra order without a study-size cap", () => {
  const extra: number[] = [];
  for (let block = 0; block < 20; block++) {
    const slots = Array.from({ length: 5 }, (_, offset) => orderForEnrollment(block * 5 + offset + 1));
    assert.deepEqual(slots.map(slot => slot.block), Array(5).fill(block + 1));
    assert.equal(new Set(slots.map(slot => slot.orderIndex)).size, 4);
    extra.push(slots[4].orderIndex);
  }
  for (let index = 0; index < extra.length; index++) assert.equal(extra[index], index % 4);
  assert.equal(orderForEnrollment(1001).conditions.length, 4);
  for (const order of STUDY_ORDERS) assert.equal(new Set(order).size, 4);
});

test("every condition occupies each position equally across four orders", () => {
  for (let position = 0; position < 4; position++)
    assert.deepEqual(new Set(STUDY_ORDERS.map(order => order[position])), new Set(["A", "B", "C", "D"]));
});
