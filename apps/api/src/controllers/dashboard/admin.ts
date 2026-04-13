import { Request, Response } from "express";
import { createClient } from "@supabase/supabase-js";
import { config } from "../../config";
import { DashboardAuthRequest } from "../../lib/dashboard-auth";

const supabase = createClient(
  config.SUPABASE_URL || "",
  config.SUPABASE_SERVICE_TOKEN || "",
);

export async function getPlanConfigs(req: DashboardAuthRequest, res: Response) {
  try {
    const { isAdmin } = req.auth!;

    if (!isAdmin) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const { data: planConfigs, error } = await supabase
      .from("plan_configs")
      .select("*")
      .order("sort_order", { ascending: true });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ planConfigs });
  } catch (error) {
    console.error("Get plan configs error:", error);
    res.status(500).json({ error: "Failed to fetch plan configurations" });
  }
}

export async function updatePlanConfig(req: DashboardAuthRequest, res: Response) {
  try {
    const { isAdmin } = req.auth!;

    if (!isAdmin) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const { id } = req.params;
    const updates = req.body;

    const { data: updatedConfig, error } = await supabase
      .from("plan_configs")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Clear ACUC cache to make new quotas take effect immediately
    // TODO: Implement acucCacheClear function call

    res.json({ planConfig: updatedConfig });
  } catch (error) {
    console.error("Update plan config error:", error);
    res.status(500).json({ error: "Failed to update plan configuration" });
  }
}

export async function getAllTeams(req: DashboardAuthRequest, res: Response) {
  try {
    const { isAdmin } = req.auth!;

    if (!isAdmin) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const { page = 1, limit = 50 } = req.query as any;
    const offset = (page - 1) * limit;

    const { data: teams, error } = await supabase
      .from("teams")
      .select("id, name, created_at, auto_recharge, auto_recharge_threshold")
      .range(offset, offset + limit - 1)
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Get credit usage for each team
    const teamIds = teams?.map((t: any) => t.id) || [];
    const { data: creditUsage } = await supabase
      .from("credit_usage")
      .select("team_id, credits")
      .in("team_id", teamIds);

    const teamUsageMap = new Map();
    creditUsage?.forEach((usage: any) => {
      const current = teamUsageMap.get(usage.team_id) || 0;
      teamUsageMap.set(usage.team_id, current + usage.credits);
    });

    const teamsWithUsage = teams?.map((team: any) => ({
      ...team,
      creditsUsed: teamUsageMap.get(team.id) || 0,
    })) || [];

    res.json({ teams: teamsWithUsage });
  } catch (error) {
    console.error("Get all teams error:", error);
    res.status(500).json({ error: "Failed to fetch teams" });
  }
}

export async function getTeamDetails(req: DashboardAuthRequest, res: Response) {
  try {
    const { isAdmin } = req.auth!;

    if (!isAdmin) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const { id } = req.params;

    const { data: team, error } = await supabase
      .from("teams")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !team) {
      return res.status(404).json({ error: "Team not found" });
    }

    // Get members
    const { data: members } = await supabase
      .from("user_teams")
      .select(`
        user_id,
        users (email)
      `)
      .eq("team_id", id);

    // Get API keys
    const { data: apiKeys } = await supabase
      .from("api_keys")
      .select("id, name, created_at, owner_id")
      .eq("team_id", id);

    // Get subscription
    const { data: subscription } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("team_id", id)
      .in("status", ["active", "trialing"])
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    res.json({
      team,
      members: members || [],
      apiKeys: apiKeys || [],
      subscription: subscription || null,
    });
  } catch (error) {
    console.error("Get team details error:", error);
    res.status(500).json({ error: "Failed to fetch team details" });
  }
}

export async function setTeamFlags(req: DashboardAuthRequest, res: Response) {
  try {
    const { isAdmin } = req.auth!;

    if (!isAdmin) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const { id } = req.params;
    const { flags } = req.body;

    // TODO: Implement team flags storage (could be a team_flags table or a JSON column in teams)
    // For now, return a placeholder response
    res.json({ success: true, message: "Team flags updated (implementation pending)" });
  } catch (error) {
    console.error("Set team flags error:", error);
    res.status(500).json({ error: "Failed to set team flags" });
  }
}

export async function addTeamCoupon(req: DashboardAuthRequest, res: Response) {
  try {
    const { isAdmin } = req.auth!;

    if (!isAdmin) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const { id } = req.params;
    const { credits, expiresAt } = req.body;

    const { error } = await supabase.from("coupons").insert({
      team_id: id,
      credits,
      status: "active",
      expires_at: expiresAt || null,
    });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Add team coupon error:", error);
    res.status(500).json({ error: "Failed to add team coupon" });
  }
}
