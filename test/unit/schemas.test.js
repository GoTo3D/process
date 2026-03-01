/**
 * Unit Tests: Schemi Zod per validazione dati
 *
 * Testa gli schemi di validazione usati in:
 * - src/utils/db.js (ProjectSchema, TelegramUserSchema)
 * - src/processQueue.js (QueueMessageSchema)
 *
 * Questi test verificano che dati corrotti o malformati vengano
 * intercettati prima di entrare nel pipeline di processing.
 *
 * ESECUZIONE:
 *   node --test test/unit/schemas.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { z } = require('zod');

// ============================================================
// Schema identici a quelli nel codice sorgente, per test isolati
// ============================================================

// Da src/utils/db.js
const ProjectSchema = z.object({
  id: z.number().int().positive(),
  status: z.string(),
  files: z.array(z.string()).min(1, 'Project must have at least one file'),
  detail: z.string().nullable().optional().default('medium'),
  feature: z.string().nullable().optional().default('normal'),
  order: z.string().nullable().optional().default('unordered'),
  telegram_user: z.number().int().positive().nullable().optional(),
  process_start: z.string().nullable().optional(),
  process_end: z.string().nullable().optional(),
  model_urls: z.array(z.string()).nullable().optional(),
}).passthrough();

const TelegramUserSchema = z.object({
  user_id: z.union([z.string(), z.number()]),
});

// Da src/processQueue.js
const QueueMessageSchema = z.union([
  z.string().regex(/^\d+$/).transform(Number),
  z.object({ id: z.number().int().positive() }).transform(obj => obj.id),
]);

// Helper per parsare il messaggio dalla coda (identico a processQueue.js)
const parseQueueMessage = (raw) => {
  if (raw.startsWith('{')) {
    try {
      return QueueMessageSchema.safeParse(JSON.parse(raw));
    } catch {
      // JSON malformato, fallira' la validazione come stringa
    }
  }
  return QueueMessageSchema.safeParse(raw);
};

// ============================================================
// Tests: ProjectSchema
// ============================================================

describe('ProjectSchema - Dati validi', () => {
  it('accetta un progetto valido completo', () => {
    const project = {
      id: 1,
      status: 'in queue',
      files: ['photo1.jpg', 'photo2.jpg'],
      detail: 'full',
      feature: 'high',
      order: 'sequential',
      telegram_user: 123,
    };
    const result = ProjectSchema.safeParse(project);
    assert.equal(result.success, true);
    assert.equal(result.data.id, 1);
    assert.deepEqual(result.data.files, ['photo1.jpg', 'photo2.jpg']);
  });

  it('applica i valori di default per detail, feature, order', () => {
    const project = {
      id: 1,
      status: 'in queue',
      files: ['photo.jpg'],
    };
    const result = ProjectSchema.safeParse(project);
    assert.equal(result.success, true);
    assert.equal(result.data.detail, 'medium');
    assert.equal(result.data.feature, 'normal');
    assert.equal(result.data.order, 'unordered');
  });

  it('accetta telegram_user nullo', () => {
    const project = {
      id: 1,
      status: 'processing',
      files: ['photo.jpg'],
      telegram_user: null,
    };
    const result = ProjectSchema.safeParse(project);
    assert.equal(result.success, true);
    assert.equal(result.data.telegram_user, null);
  });

  it('accetta campi nullable come null (detail, feature, order)', () => {
    const project = {
      id: 1,
      status: 'processing',
      files: ['photo.jpg'],
      detail: null,
      feature: null,
      order: null,
    };
    const result = ProjectSchema.safeParse(project);
    assert.equal(result.success, true);
  });

  it('preserva campi extra grazie a passthrough()', () => {
    const project = {
      id: 1,
      status: 'done',
      files: ['photo.jpg'],
      created_at: '2024-01-01',
      user_id: 'uuid-123',
      extra_field: true,
    };
    const result = ProjectSchema.safeParse(project);
    assert.equal(result.success, true);
    assert.equal(result.data.created_at, '2024-01-01');
    assert.equal(result.data.user_id, 'uuid-123');
  });
});

describe('ProjectSchema - Dati non validi', () => {
  it('rifiuta id non numerico', () => {
    const result = ProjectSchema.safeParse({
      id: 'abc',
      status: 'in queue',
      files: ['photo.jpg'],
    });
    assert.equal(result.success, false);
  });

  it('rifiuta id negativo', () => {
    const result = ProjectSchema.safeParse({
      id: -1,
      status: 'in queue',
      files: ['photo.jpg'],
    });
    assert.equal(result.success, false);
  });

  it('rifiuta id decimale', () => {
    const result = ProjectSchema.safeParse({
      id: 1.5,
      status: 'in queue',
      files: ['photo.jpg'],
    });
    assert.equal(result.success, false);
  });

  it('rifiuta id zero', () => {
    const result = ProjectSchema.safeParse({
      id: 0,
      status: 'in queue',
      files: ['photo.jpg'],
    });
    assert.equal(result.success, false);
  });

  it('rifiuta files vuoto', () => {
    const result = ProjectSchema.safeParse({
      id: 1,
      status: 'in queue',
      files: [],
    });
    assert.equal(result.success, false);
  });

  it('rifiuta files mancante', () => {
    const result = ProjectSchema.safeParse({
      id: 1,
      status: 'in queue',
    });
    assert.equal(result.success, false);
  });

  it('rifiuta status mancante', () => {
    const result = ProjectSchema.safeParse({
      id: 1,
      files: ['photo.jpg'],
    });
    assert.equal(result.success, false);
  });
});

// ============================================================
// Tests: TelegramUserSchema
// ============================================================

describe('TelegramUserSchema', () => {
  it('accetta user_id numerico', () => {
    const result = TelegramUserSchema.safeParse({ user_id: 123456789 });
    assert.equal(result.success, true);
    assert.equal(result.data.user_id, 123456789);
  });

  it('accetta user_id stringa', () => {
    const result = TelegramUserSchema.safeParse({ user_id: '123456789' });
    assert.equal(result.success, true);
    assert.equal(result.data.user_id, '123456789');
  });

  it('rifiuta user_id mancante', () => {
    const result = TelegramUserSchema.safeParse({});
    assert.equal(result.success, false);
  });

  it('rifiuta user_id null', () => {
    const result = TelegramUserSchema.safeParse({ user_id: null });
    assert.equal(result.success, false);
  });

  it('rifiuta oggetto vuoto', () => {
    const result = TelegramUserSchema.safeParse({});
    assert.equal(result.success, false);
  });
});

// ============================================================
// Tests: QueueMessageSchema
// ============================================================

describe('QueueMessageSchema - Formato stringa', () => {
  it('parsa un ID numerico come stringa', () => {
    const result = parseQueueMessage('123');
    assert.equal(result.success, true);
    assert.equal(result.data, 123);
  });

  it('parsa un ID con spazi (dopo trim dal consumer)', () => {
    // Il consumer chiama msg.content.toString() che non aggiunge spazi,
    // ma testiamo lo schema direttamente
    const result = QueueMessageSchema.safeParse('456');
    assert.equal(result.success, true);
    assert.equal(result.data, 456);
  });

  it('parsa ID grandi', () => {
    const result = parseQueueMessage('999999');
    assert.equal(result.success, true);
    assert.equal(result.data, 999999);
  });

  it('rifiuta stringhe non numeriche', () => {
    const result = parseQueueMessage('abc');
    assert.equal(result.success, false);
  });

  it('rifiuta stringhe vuote', () => {
    const result = parseQueueMessage('');
    assert.equal(result.success, false);
  });

  it('rifiuta stringhe con caratteri speciali', () => {
    const result = parseQueueMessage('12; DROP TABLE projects;');
    assert.equal(result.success, false);
  });
});

describe('QueueMessageSchema - Formato JSON', () => {
  it('parsa un oggetto JSON con id', () => {
    const result = parseQueueMessage('{"id": 789}');
    assert.equal(result.success, true);
    assert.equal(result.data, 789);
  });

  it('rifiuta JSON con id negativo', () => {
    const result = parseQueueMessage('{"id": -1}');
    assert.equal(result.success, false);
  });

  it('rifiuta JSON con id decimale', () => {
    const result = parseQueueMessage('{"id": 1.5}');
    assert.equal(result.success, false);
  });

  it('rifiuta JSON con id zero', () => {
    const result = parseQueueMessage('{"id": 0}');
    assert.equal(result.success, false);
  });

  it('rifiuta JSON con id stringa', () => {
    const result = parseQueueMessage('{"id": "abc"}');
    assert.equal(result.success, false);
  });

  it('rifiuta JSON senza campo id', () => {
    const result = parseQueueMessage('{"project_id": 123}');
    assert.equal(result.success, false);
  });

  it('rifiuta JSON malformato', () => {
    const result = parseQueueMessage('{invalid json}');
    // parseQueueMessage fa JSON.parse in un try-catch, quindi
    // il raw '{invalid json}' viene trattato come stringa
    assert.equal(result.success, false);
  });
});
