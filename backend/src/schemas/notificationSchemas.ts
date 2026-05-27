import { z } from "zod";

const e164PhoneRegex = /^\+?[1-9]\d{1,14}$/;

const perTypeOverridesSchema = z.record(z.string(), z.boolean()).default({});

export const updateNotificationPreferencesSchema = z.object({
  emailEnabled: z.boolean(),
  smsEnabled: z.boolean(),
  phone: z.string().trim().max(20).nullable().optional(),
  perTypeOverrides: perTypeOverridesSchema.optional(),
});

export const notificationPreferencesResponseSchema = z.object({
  emailEnabled: z.boolean(),
  smsEnabled: z.boolean(),
  phone: z.string().nullable(),
  perTypeOverrides: perTypeOverridesSchema,
});

export const validateNotificationPhone = (phone: string | null): boolean => {
  if (!phone) return true;
  return e164PhoneRegex.test(phone);
};
