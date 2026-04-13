import { randomUUID } from "node:crypto";

import type { DatabaseClient } from "../persistence/db.js";
import type { ApprovalRecord, ApprovalType } from "../types/domain.js";

function nowIso(): string {
  return new Date().toISOString();
}

export class ApprovalService {
  constructor(private readonly db: DatabaseClient) {}

  requestApproval(input: {
    sessionId: string;
    runId?: string;
    type: ApprovalType;
    requestedBy: string;
    payload: Record<string, unknown>;
  }): ApprovalRecord {
    const approval: ApprovalRecord = {
      id: randomUUID(),
      sessionId: input.sessionId,
      runId: input.runId ?? null,
      type: input.type,
      status: "pending",
      requestedBy: input.requestedBy,
      decidedBy: null,
      createdAt: nowIso(),
      decidedAt: null,
      payloadJson: JSON.stringify(input.payload)
    };
    this.db.createApproval(approval);
    return approval;
  }

  approve(approvalId: string, decidedBy: string, payload?: Record<string, unknown>): ApprovalRecord {
    const approval = this.db.getApprovalById(approvalId);
    if (!approval) {
      throw new Error(`Approval ${approvalId} not found`);
    }
    this.db.updateApprovalStatus(
      approvalId,
      "approved",
      decidedBy,
      payload ? JSON.stringify(payload) : undefined
    );
    const updated = this.db.getApprovalById(approvalId);
    if (!updated) {
      throw new Error(`Approval ${approvalId} disappeared after approval`);
    }
    return updated;
  }

  reject(approvalId: string, decidedBy: string, payload?: Record<string, unknown>): ApprovalRecord {
    const approval = this.db.getApprovalById(approvalId);
    if (!approval) {
      throw new Error(`Approval ${approvalId} not found`);
    }
    this.db.updateApprovalStatus(
      approvalId,
      "rejected",
      decidedBy,
      payload ? JSON.stringify(payload) : undefined
    );
    const updated = this.db.getApprovalById(approvalId);
    if (!updated) {
      throw new Error(`Approval ${approvalId} disappeared after rejection`);
    }
    return updated;
  }
}
