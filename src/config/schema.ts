/**
 * Schémas de validation Zod du profil d'exécution. Voir architecture.md §6.
 * Le type Config est dérivé du schéma via z.infer — source unique de vérité.
 */
import { z } from 'zod';
import { readFileSync } from 'node:fs';

const FilterConditionSchema = z.object({
  label: z.string(),
  /** Enum à un seul membre pour l'instant — extensible (contains, not_equals...) sans casser le format existant. */
  criterium: z.enum(['equals']),
  value: z.string(),
});

const FilterSchema = z.object({
  /** all = ET, any = OU, none = NI l'un ni l'autre (négation de "any"). */
  match: z.enum(['all', 'any', 'none']),
  conditions: z.array(FilterConditionSchema).min(1),
});

export type FilterCondition = z.infer<typeof FilterConditionSchema>;
export type Filter = z.infer<typeof FilterSchema>;

const InstanceMetaSchema = z.object({
  name: z.string().max(80).optional(),
  description: z.string().max(500).optional(),
  /** Désactive l'instance : ignorée à l'exécution, jamais appelée ni référencée (voir superRefine ci-dessous). */
  disable: z.boolean().optional().default(false),
  /** Exécution conditionnelle par ligne, évaluée sur rawData — voir filterEngine.ts. */
  filter: FilterSchema.optional(),
});

const FileModuleFieldsSchema = z
  .object({
    template_id: z.string(),
    /** Purement informatif — jamais lu par l'application. Un aide-mémoire pour l'utilisateur (lien Drive du template). */
    template_link: z.string().optional(),
    output_folder: z.string().optional(),
    output_folder_id: z.string().optional(),
    output_filename: z.string(),
  })
  .merge(InstanceMetaSchema);

const outputFolderXorRefine = (i: { output_folder?: string; output_folder_id?: string }): boolean =>
  Boolean(i.output_folder) !== Boolean(i.output_folder_id);
const outputFolderXorMessage = {
  message: 'Exactement une des deux clés output_folder / output_folder_id doit être fournie.',
};

export const PdfInstanceSchema = FileModuleFieldsSchema.refine(
  outputFolderXorRefine,
  outputFolderXorMessage,
);

const ShareConfigSchema = z
  .object({
    email: z
      .object({
        addresses: z.array(z.string()),
        permission: z.enum(['reader', 'commenter', 'editor']),
      })
      .optional(),
    link: z
      .object({
        permission: z.enum(['reader', 'commenter', 'editor']),
      })
      .optional(),
  })
  .refine((share) => Boolean(share.email) || Boolean(share.link), {
    message: 'share doit contenir au moins une des deux clés email ou link.',
  })
  .optional();

export const GdocsInstanceSchema = FileModuleFieldsSchema.extend({
  share: ShareConfigSchema,
}).refine(outputFolderXorRefine, outputFolderXorMessage);

export const MailInstanceSchema = z
  .object({
    to: z.string(),
    cc: z.array(z.string()).optional().default([]),
    subject: z.string(),
    template_html: z.string().optional(),
    template_html_path: z.string().optional(),
    draft_only: z.boolean(),
    attach: z.enum(['all', 'generated', 'external', 'none']),
    generated: z.array(z.string()).optional().default([]),
    externalFolder: z.string().optional(),
    external: z.array(z.string()).optional().default([]),
  })
  .merge(InstanceMetaSchema)
  .refine((mail) => Boolean(mail.template_html) !== Boolean(mail.template_html_path), {
    message: 'Exactement une des deux clés template_html / template_html_path doit être fournie.',
  })
  .refine((mail) => !(mail.attach === 'all' && (mail.generated.length === 0 || mail.external.length === 0)), {
    message: 'attach: "all" nécessite que generated ET external soient tous les deux non vides.',
  })
  .refine((mail) => !(mail.attach === 'generated' && (mail.generated.length === 0 || mail.external.length > 0)), {
    message: 'attach: "generated" nécessite generated non vide et external vide.',
  })
  .refine((mail) => !(mail.attach === 'external' && (mail.external.length === 0 || mail.generated.length > 0)), {
    message: 'attach: "external" nécessite external non vide et generated vide.',
  })
  .refine((mail) => !(mail.attach === 'none' && (mail.generated.length > 0 || mail.external.length > 0)), {
    message: 'attach: "none" nécessite generated ET external vides.',
  })
  .refine((mail) => mail.external.length === 0 || Boolean(mail.externalFolder), {
    message: 'externalFolder est requis dès que external est utilisé.',
  });

export const ProfileSchema = z
  .object({
    sheetId: z.string(),
    sheetTabName: z.string(),
    autoCreateFolders: z.boolean().default(true),
    defaultDateFormat: z.string().default('d/M/yyyy'),
    gdocs: z.array(GdocsInstanceSchema).optional().default([]),
    pdf: z.array(PdfInstanceSchema).optional().default([]),
    mail: z.array(MailInstanceSchema).optional().default([]),
  })
  .superRefine((config, ctx) => {
    const pdfRefs = new Set(config.pdf.map((_, i) => `pdf[${i}]`));
    const linkableRefs = new Set([
      ...config.gdocs.map((_, i) => `gdocs[${i}]`),
      ...pdfRefs,
    ]);
    const disabledRefs = new Set([
      ...config.gdocs.flatMap((instance, i) => (instance.disable ? [`gdocs[${i}]`] : [])),
      ...config.pdf.flatMap((instance, i) => (instance.disable ? [`pdf[${i}]`] : [])),
    ]);

    const LINK_TAG_PATTERN = /\{\{link:([a-zA-Z]+\[\d+\])\}\}/g;
    const extractLinkRefs = (text: string): string[] =>
      [...text.matchAll(LINK_TAG_PATTERN)].map((m) => m[1]);

    config.mail.forEach((mailInstance, mailIndex) => {
      const seenGenerated = new Set<string>();
      for (const ref of mailInstance.generated) {
        if (!pdfRefs.has(ref)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `mail[${mailIndex}].generated : "${ref}" doit référencer une instance pdf[] (un gDoc ne peut pas être joint à un email)`,
          });
        } else if (disabledRefs.has(ref)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `mail[${mailIndex}].generated : "${ref}" est désactivée (disable: true) — impossible de la joindre.`,
          });
        }
        if (seenGenerated.has(ref)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `mail[${mailIndex}].generated : référence "${ref}" dupliquée`,
          });
        }
        seenGenerated.add(ref);
      }

      let bodyContent = mailInstance.template_html ?? '';
      if (mailInstance.template_html_path) {
        try {
          bodyContent = readFileSync(mailInstance.template_html_path, 'utf-8');
        } catch {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `mail[${mailIndex}].template_html_path : fichier "${mailInstance.template_html_path}" introuvable ou illisible`,
          });
        }
      }

      const fieldsToScan = [mailInstance.to, ...mailInstance.cc, mailInstance.subject, bodyContent];
      for (const field of fieldsToScan) {
        for (const ref of extractLinkRefs(field)) {
          if (!linkableRefs.has(ref)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `mail[${mailIndex}] : {{link:${ref}}} référence une instance introuvable`,
            });
          } else if (disabledRefs.has(ref)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `mail[${mailIndex}] : {{link:${ref}}} référence une instance désactivée (disable: true)`,
            });
          }
        }
      }
    });
  });

export type Config = z.infer<typeof ProfileSchema>;
export type GdocsInstance = z.infer<typeof GdocsInstanceSchema>;
export type PdfInstance = z.infer<typeof PdfInstanceSchema>;
export type MailInstance = z.infer<typeof MailInstanceSchema>;
