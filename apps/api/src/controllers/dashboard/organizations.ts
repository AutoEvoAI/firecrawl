import { Request, Response } from "express";
import { createClient } from "@supabase/supabase-js";
import { config } from "../../config";
import { DashboardAuthRequest } from "../../lib/dashboard-auth";

const supabase = createClient(
  config.SUPABASE_URL || "",
  config.SUPABASE_SERVICE_TOKEN || "",
);

export async function getOrganizations(req: DashboardAuthRequest, res: Response) {
  try {
    const { teamId } = req.auth!;

    // Get organization for the current team
    const { data: team } = await supabase
      .from("teams")
      .select("org_id, organizations (*)")
      .eq("id", teamId)
      .single();

    if (!team) {
      return res.status(404).json({ error: "Team not found" });
    }

    res.json({
      organization: team.organizations,
    });
  } catch (error) {
    console.error("Get organizations error:", error);
    res.status(500).json({ error: "Failed to fetch organizations" });
  }
}

export async function createOrganization(req: DashboardAuthRequest, res: Response) {
  try {
    const { teamId, userId } = req.auth!;
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Organization name is required" });
    }

    // Create organization
    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .insert({ name })
      .select()
      .single();

    if (orgError) {
      return res.status(500).json({ error: "Failed to create organization" });
    }

    // Update team to link to new organization
    const { error: teamError } = await supabase
      .from("teams")
      .update({ org_id: org.id })
      .eq("id", teamId);

    if (teamError) {
      return res.status(500).json({ error: "Failed to link team to organization" });
    }

    res.json({ success: true, organization: org });
  } catch (error) {
    console.error("Create organization error:", error);
    res.status(500).json({ error: "Failed to create organization" });
  }
}

export async function getTeams(req: DashboardAuthRequest, res: Response) {
  try {
    const { teamId } = req.auth!;

    // Get organization for the current team
    const { data: team } = await supabase
      .from("teams")
      .select("org_id")
      .eq("id", teamId)
      .single();

    if (!team) {
      return res.status(404).json({ error: "Team not found" });
    }

    // Get all teams in the same organization
    const { data: teams } = await supabase
      .from("teams")
      .select("*")
      .eq("org_id", team.org_id);

    res.json({ teams: teams || [] });
  } catch (error) {
    console.error("Get teams error:", error);
    res.status(500).json({ error: "Failed to fetch teams" });
  }
}

export async function createTeam(req: DashboardAuthRequest, res: Response) {
  try {
    const { teamId, userId } = req.auth!;
    const { name, orgId } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Team name is required" });
    }

    // Get org_id from current team if not provided
    let targetOrgId = orgId;
    if (!targetOrgId) {
      const { data: currentTeam } = await supabase
        .from("teams")
        .select("org_id")
        .eq("id", teamId)
        .single();

      targetOrgId = currentTeam?.org_id;
    }

    if (!targetOrgId) {
      return res.status(400).json({ error: "Organization ID is required" });
    }

    // Create team
    const { data: team, error: teamError } = await supabase
      .from("teams")
      .insert({
        name,
        org_id: targetOrgId,
        created_by: userId,
        plan_id: "free",
        credits: 0,
      })
      .select()
      .single();

    if (teamError) {
      return res.status(500).json({ error: "Failed to create team" });
    }

    // Link user to team
    const { error: userTeamError } = await supabase
      .from("user_teams")
      .insert({
        user_id: userId,
        team_id: team.id,
        role: "owner",
      });

    if (userTeamError) {
      console.error("Failed to link user to team:", userTeamError);
    }

    res.json({ success: true, team });
  } catch (error) {
    console.error("Create team error:", error);
    res.status(500).json({ error: "Failed to create team" });
  }
}
