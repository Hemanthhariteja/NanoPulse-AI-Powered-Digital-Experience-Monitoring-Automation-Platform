import { z } from 'zod';

const pct = z.number().min(0).max(100);
const nonNeg = z.number().min(0);

export const deviceRegisterSchema = z.object({
  enrollmentKey: z.string().min(8).max(128),
  deviceId: z.string().uuid().optional(),
  hostname: z.string().trim().min(1).max(255),
  operatingSystem: z.string().trim().max(100).default('Unknown'),
  osVersion: z.string().trim().max(200).optional(),
  architecture: z.string().trim().max(50).optional(),
  ipAddress: z.string().trim().max(64).optional(),
  deviceType: z.enum(['workstation', 'laptop', 'server', 'virtual']).optional(),
  agentVersion: z.string().trim().max(50).optional(),
  capabilities: z
    .object({
      demoApp: z.boolean().default(false),
      safeTempDir: z.boolean().default(false),
      actions: z.array(z.string().max(64)).max(32).default([]),
    })
    .optional(),
});

export const telemetrySchema = z.object({
  cpuUsage: pct,
  cpuCount: z.number().int().min(1).max(1024).optional(),
  ramUsage: pct,
  ramTotalBytes: nonNeg.optional(),
  ramAvailableBytes: nonNeg.optional(),
  diskUsage: pct,
  diskTotalBytes: nonNeg.optional(),
  diskFreeBytes: nonNeg.optional(),
  networkUpload: nonNeg.default(0),
  networkDownload: nonNeg.default(0),
  networkBytesSent: nonNeg.optional(),
  networkBytesRecv: nonNeg.optional(),
  networkConnected: z.boolean().default(true),
  uptimeSeconds: nonNeg.default(0),
  ipAddress: z.string().max(64).optional(),
  processes: z
    .array(
      z.object({
        pid: z.number().int().min(0),
        name: z.string().max(260),
        cpuPercent: z.number().min(0).max(100),
        memoryPercent: z.number().min(0).max(100),
        memoryBytes: nonNeg.optional(),
        isDemoApp: z.boolean().optional(),
      })
    )
    .max(25)
    .default([]),
  interfaces: z
    .array(
      z.object({
        name: z.string().max(200),
        addresses: z.array(z.string().max(64)).max(10).default([]),
        isUp: z.boolean().optional(),
        speedMbps: z.number().min(0).optional(),
      })
    )
    .max(16)
    .default([]),
});

export const commandResultSchema = z.object({
  status: z.enum(['SUCCEEDED', 'FAILED']),
  summary: z.string().trim().min(1).max(2000),
  data: z.any().optional(),
  verification: z.any().optional(),
  error: z.string().max(4000).optional(),
  durationMs: z.number().min(0).optional(),
  mode: z.enum(['REAL', 'SIMULATED']).default('REAL'),
});

export const rangeQuery = (ranges, fallback = '24h') => ({ range: z.enum(ranges).default(fallback) });
