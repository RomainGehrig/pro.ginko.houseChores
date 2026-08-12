// ABOUTME: Unit tests for the ripeness fraction, its colour ramp, and pool ordering.
// ABOUTME: Ripeness is warmth, never lateness — no case here may produce a warning.

import test from 'node:test'
import assert from 'node:assert/strict'

import { ripeness, ripenessColor, poolOrder } from './ripenessLogic.js'

const TODAY = '2026-08-12'

const periodic = (every, unit = 'day') => ({ type: 'periodic', every, unit })

test('an undated chore is the coolest thing in the bed', () => {
  assert.equal(ripeness({ name: 'Someday', schedule: null }, TODAY), 0)
})

test('a chore scheduled far ahead cools towards the cold end of the ramp', () => {
  const task = { scheduledDate: '2026-10-30', schedule: periodic(7) }
  assert.equal(ripeness(task, TODAY), 0)
})

test('a chore due today reads warm without being late', () => {
  const task = { scheduledDate: TODAY, schedule: periodic(7) }
  assert.equal(ripeness(task, TODAY), 0.66)
})

test('warmth rises across the days a chore waits past its date', () => {
  const schedule = periodic(10)
  const justPast = ripeness({ scheduledDate: '2026-08-10', schedule }, TODAY)
  const wellPast = ripeness({ scheduledDate: '2026-07-28', schedule }, TODAY)
  assert.ok(justPast > 0.66, String(justPast))
  assert.ok(wellPast > justPast, justPast + ' then ' + wellPast)
})

test('warmth saturates so one forgotten chore cannot outrank everything forever', () => {
  const schedule = periodic(7)
  const lateOnce = ripeness({ scheduledDate: '2026-07-01', schedule }, TODAY)
  const lateForever = ripeness({ scheduledDate: '2020-01-01', schedule }, TODAY)
  assert.equal(lateForever, 1)
  assert.ok(lateOnce <= 1, String(lateOnce))
})

test('a chore approaching its date warms as the date nears', () => {
  const schedule = periodic(14)
  const nextWeek = ripeness({ scheduledDate: '2026-08-19', schedule }, TODAY)
  const tomorrow = ripeness({ scheduledDate: '2026-08-13', schedule }, TODAY)
  assert.ok(tomorrow > nextWeek, nextWeek + ' then ' + tomorrow)
  assert.ok(tomorrow < 0.66, String(tomorrow))
})

test('a chore with no cadence still warms over a default horizon', () => {
  const task = { scheduledDate: '2026-08-14', schedule: { type: 'one_off' } }
  const value = ripeness(task, TODAY)
  assert.ok(value > 0 && value < 0.66, String(value))
})

test('the ramp mixes the two ripeness tokens so both themes stay honest', () => {
  assert.equal(ripenessColor(0), 'color-mix(in srgb, var(--ripe-warm) 0%, var(--ripe-cold))')
  assert.equal(ripenessColor(1), 'color-mix(in srgb, var(--ripe-warm) 100%, var(--ripe-cold))')
  assert.equal(ripenessColor(0.5), 'color-mix(in srgb, var(--ripe-warm) 50%, var(--ripe-cold))')
})

test('the ramp clamps rather than emitting an impossible mix', () => {
  assert.equal(ripenessColor(-3), 'color-mix(in srgb, var(--ripe-warm) 0%, var(--ripe-cold))')
  assert.equal(ripenessColor(42), 'color-mix(in srgb, var(--ripe-warm) 100%, var(--ripe-cold))')
})

test('the pool runs ripest first, and undated chores bring up the rear', () => {
  const tasks = [
    { _id: 'someday', name: 'Plan the shop', status: 'approved_once' },
    { _id: 'ready', name: 'Empty the dishwasher', status: 'approved_recurring', scheduledDate: '2026-08-05', schedule: periodic(2) },
    { _id: 'later', name: 'Descale the kettle', status: 'approved_recurring', scheduledDate: '2026-09-20', schedule: periodic(60) },
    { _id: 'today', name: 'Water the plants', status: 'approved_recurring', scheduledDate: TODAY, schedule: periodic(4) }
  ]

  assert.deepEqual(poolOrder(tasks, TODAY).map(task => task._id), ['ready', 'today', 'later', 'someday'])
})

test('pool ordering tolerates an empty bed', () => {
  assert.deepEqual(poolOrder([], TODAY), [])
  assert.deepEqual(poolOrder(null, TODAY), [])
})
