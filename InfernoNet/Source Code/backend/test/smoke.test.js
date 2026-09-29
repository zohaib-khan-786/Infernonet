import { describe, expect, it } from 'vitest';
import { makeTestStack } from './helpers.js';
import { snapshotFixture } from '../src/ingest/fixtures.js';

describe('smoke', () => {
  it('accepts a valid snapshot and serves the aggregate', async () => {
    const { post, get } = makeTestStack();
    const ingest = await post('fg-01', snapshotFixture()).expect(200);
    expect(ingest.body.outcome).toBe('stored');

    const current = await get('/api/v1/devices/fg-01/current').expect(200);
    expect(current.body.device.zone_status).toEqual({ code: 0, label: 'fresh' });
    expect(current.body.inventory).toHaveLength(1);
  });
});
