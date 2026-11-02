/**
 * NF8 guard test: the string 'BbbScheduledSession' is used in a string-named
 * repository lookup in CourseScheduledSessionService.addSession. If the BBB
 * entity is ever renamed, this lookup would silently fail (return null) and
 * the session link would be rejected with "Scheduled session not found".
 *
 * This test verifies that the string name matches the actual entity table
 * name so a rename is caught at test time, not in production.
 */
import { describe, it, expect } from 'vitest';
import { getMetadataArgsStorage } from 'typeorm';
import { BbbScheduledSession } from '../../bigbluebutton-plugin/entities/bbb-scheduled-session.entity';

describe('NF8 — BbbScheduledSession string-name guard', () => {
  it('the BBB scheduled session entity is named "BbbScheduledSession"', () => {
    // The string used in CourseScheduledSessionService.addSession must match
    // the actual entity class name that TypeORM registers.
    const storage = getMetadataArgsStorage();
    const tables = storage.tables.map((t) => t.name);
    expect(tables).toContain('bbb_scheduled_session');

    // The entity class must still be exported under the expected name
    expect(BbbScheduledSession).toBeDefined();
    expect(BbbScheduledSession.name).toBe('BbbScheduledSession');
  });
});
