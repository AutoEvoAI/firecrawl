import { Request, Response } from "express";
import { createClient } from "@supabase/supabase-js";
import { config } from "../../config";
import { DashboardAuthRequest } from "../../lib/dashboard-auth";

const supabase = createClient(
  config.SUPABASE_URL || "",
  config.SUPABASE_SERVICE_TOKEN || "",
);

export async function getQueueStatus(req: DashboardAuthRequest, res: Response) {
  try {
    const { teamId } = req.auth!;

    // Get team configuration for concurrency
    const { data: team } = await supabase
      .from("teams")
      .select("plan_id")
      .eq("id", teamId)
      .single();

    let maxConcurrent = 2;
    if (team?.plan_id) {
      const { data: planConfig } = await supabase
        .from("plan_configs")
        .select("concurrency")
        .eq("id", team.plan_id)
        .single();

      if (planConfig) {
        maxConcurrent = planConfig.concurrency || 2;
      }
    }

    // For now, return mock queue status data
    // In a real implementation, this would query the actual job queue
    res.json({
      active: 0,
      waiting: 0,
      max_concurrent: maxConcurrent,
    });
  } catch (error) {
    console.error("Get queue status error:", error);
    res.status(500).json({ error: "Failed to fetch queue status" });
  }
}
