import { z } from 'zod';

const path = z.string().trim().min(1);
const stringRecord = z.record(z.string(), z.string());

export const sourceConfigSchema = z.object({
  endpoint: z.string().trim().min(1),
  method: z.enum(['GET', 'POST']),
  body: z.record(z.string(), z.unknown()).optional(),
  query: stringRecord.optional(),
  headers: stringRecord.optional(),
  itemsPath: path,
  map: z.object({
    externalId: path,
    title: path,
    snippet: path.optional(),
    publishedAt: path.optional(),
    coverUrl: path.optional(),
    url: path.optional(),
    urlTemplate: z.string().trim().min(1).optional(),
  }).refine((mapping) => Boolean(mapping.url || mapping.urlTemplate), {
    message: 'url or urlTemplate is required',
  }),
});

export type SourceConfig = z.infer<typeof sourceConfigSchema>;
