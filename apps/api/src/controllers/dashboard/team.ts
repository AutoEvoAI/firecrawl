import { Request, Response } from "express";
import { createClient } from "@supabase/supabase-js";
import { config } from "../../config";
import { DashboardAuthRequest } from "../../lib/dashboard-auth";

const supabase = createClient(
  config.SUPABASE_URL || "",
  config.SUPABASE_SERVICE_TOKEN || "",
);

export async function getTeamMembers(req: DashboardAuthRequest, res: Response) {
  try {
    const { teamId } = req.auth!;

    const { data: members, error } = await supabase
      .from("user_teams")
      .select(`
        user_id,
        users (
          id,
          email,
          created_at
        )
      `)
      .eq("team_id", teamId);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const formattedMembers = members?.map((member: any) => ({
      userId: member.user_id,
      email: member.users.email,
      createdAt: member.users.created_at,
    })) || [];

    res.json({ members: formattedMembers });
  } catch (error) {
    console.error("Get team members error:", error);
    res.status(500).json({ error: "Failed to fetch team members" });
  }
}

export async function inviteTeamMember(req: DashboardAuthRequest, res: Response) {
  try {
    const { teamId } = req.auth!;
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    // Check if user already exists
    const { data: existingUser } = await supabase
      .from("users")
      .select("id")
      .eq("email", email)
      .single();

    if (existingUser) {
      // Add to user_teams if not already a member
      const { data: existingMembership } = await supabase
        .from("user_teams")
        .select("user_id")
        .eq("team_id", teamId)
        .eq("user_id", existingUser.id)
        .single();

      if (existingMembership) {
        return res.status(400).json({ error: "User is already a team member" });
      }

      const { error: insertError } = await supabase
        .from("user_teams")
        .insert({
          user_id: existingUser.id,
          team_id: teamId,
        });

      if (insertError) {
        return res.status(500).json({ error: insertError.message });
      }

      return res.json({ success: true, message: "User added to team" });
    }

    // TODO: Send invitation email via Supabase Auth
    // For now, return a placeholder response
    res.json({
      success: true,
      message: "Invitation email would be sent (implementation pending)",
    });
  } catch (error) {
    console.error("Invite team member error:", error);
    res.status(500).json({ error: "Failed to invite team member" });
  }
}

export async function removeTeamMember(req: DashboardAuthRequest, res: Response) {
  try {
    const { teamId } = req.auth!;
    const { userId } = req.params;

    const { error } = await supabase
      .from("user_teams")
      .delete()
      .eq("team_id", teamId)
      .eq("user_id", userId);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Remove team member error:", error);
    res.status(500).json({ error: "Failed to remove team member" });
  }
}
