import { Request, Response, NextFunction } from "express";
import { config } from "../config";
import { createClient } from "@supabase/supabase-js";
import { autumnService } from "../services/autumn/autumn.service";

export interface DashboardAuthRequest extends Request {
  auth?: {
    userId: string;
    teamId: string;
    isAdmin: boolean;
  };
  body: any;
  params: any;
  query: any;
}

const supabase = createClient(
  config.SUPABASE_URL || "",
  config.SUPABASE_SERVICE_TOKEN || "",
);

export async function dashboardAuthMiddleware(
  req: DashboardAuthRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    let token: string | null = null;

    // Try to get token from Authorization header first
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7);
    }

    // If no Bearer token, try to get from cookie
    if (!token && req.cookies && req.cookies.session) {
      token = req.cookies.session;
    }

    if (!token) {
      return res
        .status(401)
        .json({
          error: "Missing or invalid authorization header or session cookie",
        });
    }

    // Verify JWT with Supabase
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: "Invalid token" });
    }

    // Get team_id from user_teams
    const { data: userTeams, error: teamsError } = await supabase
      .from("user_teams")
      .select("team_id")
      .eq("user_id", user.id)
      .limit(1)
      .single();

    let teamId: string;
    if (teamsError || !userTeams) {
      // User has no team, create one automatically
      console.log(`User ${user.id} has no team, creating one...`);

      // Create organization first
      const { data: newOrg, error: orgError } = await supabase
        .from("organizations")
        .insert({ name: "default" })
        .select()
        .single();

      if (orgError) {
        console.error("Failed to create organization:", orgError);
        return res.status(500).json({ error: "Failed to create organization" });
      }

      // Create team
      const { data: newTeam, error: teamError } = await supabase
        .from("teams")
        .insert({
          name: user.email || "Default Team",
          created_by: user.id,
          org_id: newOrg.id,
          plan_id: "free",
          credits: 0,
        })
        .select()
        .single();

      if (teamError) {
        console.error("Failed to create team:", teamError);
        return res.status(500).json({ error: "Failed to create team" });
      }

      // Update org name to match team ID
      await supabase
        .from("organizations")
        .update({ name: newTeam.id })
        .eq("id", newOrg.id);

      // Add user to user_teams
      const { error: addUserError } = await supabase.from("user_teams").insert({
        user_id: user.id,
        team_id: newTeam.id,
        role: "owner",
      });

      if (addUserError) {
        console.error("Failed to add user to team:", addUserError);
        return res.status(500).json({ error: "Failed to add user to team" });
      }

      // Create user record in users table (without team_id as it doesn't exist in the schema)
      const { error: createUserError } = await supabase.from("users").insert({
        id: user.id,
        email: user.email,
      });

      if (createUserError && createUserError.code !== "23505") {
        // Ignore duplicate key errors
        console.error("Failed to create user record:", createUserError);
      }

      // Provision in Autumn
      try {
        await autumnService.ensureOrgProvisioned({
          orgId: newOrg.id,
          name: newOrg.name,
          email: user.email,
        });
        await autumnService.ensureTeamProvisioned({
          teamId: newTeam.id,
          orgId: newOrg.id,
          name: newTeam.name,
        });
      } catch (autumnError) {
        console.error("Failed to provision Autumn:", autumnError);
        // Continue anyway, as Autumn provisioning is not critical for auth
      }

      teamId = newTeam.id;
      console.log(`Created team ${teamId} for user ${user.id}`);
    } else {
      teamId = userTeams.team_id;
    }

    // Check if user is admin based on team ownership
    // For now, we'll check if the user owns the team (simplified approach)
    // TODO: Implement proper role-based access control with a roles table
    const { data: teamOwner } = await supabase
      .from("teams")
      .select("created_by")
      .eq("id", teamId)
      .single();

    const isAdmin = teamOwner?.created_by === user.id;

    req.auth = {
      userId: user.id,
      teamId: teamId,
      isAdmin,
    };

    next();
  } catch (error) {
    console.error("Dashboard auth error:", error);
    res.status(500).json({ error: "Authentication failed" });
  }
}
