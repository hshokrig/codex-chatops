import { z } from "zod";

export const deploymentWorkflowSchema = z.object({
  workflow_id: z.string().min(1),
  ref: z.string().min(1),
  inputs: z.record(z.string(), z.string()).optional()
});

export const repoMapSchema = z.object({
  repos: z.array(
    z.object({
      slug: z.string().min(1),
      category_name: z.string().min(1),
      session_channel_id: z.string().min(1),
      events_channel_id: z.string().min(1),
      deployments_channel_id: z.string().min(1),
      local_path: z.string().min(1),
      default_branch: z.string().min(1),
      codex_profile: z.string().min(1).default("default"),
      allowed_users: z.array(z.string()).default([]),
      allowed_roles: z.array(z.string()).default([]),
      checks: z.array(z.string()).default([]),
      deploy_workflows: z
        .object({
          staging: deploymentWorkflowSchema.optional(),
          production: deploymentWorkflowSchema.optional()
        })
        .default({}),
      require_pr_approval: z.boolean().default(true),
      require_prod_confirmation: z.boolean().default(true),
      github_owner: z.string().min(1).optional(),
      github_repo: z.string().min(1).optional()
    })
  )
});
