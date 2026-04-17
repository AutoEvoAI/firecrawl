import { Request, Response } from "express";
import { createClient } from "@supabase/supabase-js";
import { config } from "../config";
import { logger } from "../lib/logger";
import { supabase_service } from "../services/supabase";
import { autumnService } from "../services/autumn/autumn.service";
import crypto from "crypto";

const supabase = createClient(
  config.SUPABASE_URL || "",
  config.SUPABASE_SERVICE_TOKEN || "",
);

/**
 * Handle Supabase auth webhook to sync users to users table
 * This webhook is triggered when a user signs up via Supabase Auth
 */
export async function handleSupabaseAuthWebhook(req: Request, res: Response) {
  try {
    const { type, record } = req.body;

    logger.info("Supabase auth webhook received", { type, userId: record?.id });

    // Handle user creation event
    if (type === "INSERT" && record && record.id) {
      const userId = record.id;
      const email = record.email;

      if (!email) {
        logger.warn("User created without email, skipping sync", { userId });
        return res.status(200).json({ success: true });
      }

      // Check if user already exists in users table
      const { data: existingUser } = await supabase_service
        .from("users")
        .select("id")
        .eq("id", userId)
        .single();

      if (existingUser) {
        logger.info("User already exists in users table", { userId });
        return res.status(200).json({ success: true });
      }

      // Create organization first
      const { data: newOrg, error: orgError } = await supabase_service
        .from("organizations")
        .insert({ name: "pending" })
        .select()
        .single();

      if (orgError) {
        logger.error("Failed to create organization", { error: orgError });
        return res
          .status(500)
          .json({ success: false, error: "Failed to create organization" });
      }

      // Create team
      const { data: newTeam, error: teamError } = await supabase_service
        .from("teams")
        .insert({
          name: email,
          created_by: userId,
          org_id: newOrg.id,
          plan_id: "free",
          credits: 0,
        })
        .select()
        .single();

      if (teamError) {
        logger.error("Failed to create team", { error: teamError });
        return res
          .status(500)
          .json({ success: false, error: "Failed to create team" });
      }

      // Update org name to match team ID
      await supabase_service
        .from("organizations")
        .update({ name: newTeam.id })
        .eq("id", newOrg.id);

      // Create user record in users table
      const { error: createUserError } = await supabase_service
        .from("users")
        .insert({
          id: userId,
          email: email,
          team_id: newTeam.id,
        });

      if (createUserError) {
        logger.error("Failed to create user record", {
          error: createUserError,
        });
        return res
          .status(500)
          .json({ success: false, error: "Failed to create user record" });
      }

      // Add user to user_teams
      const { error: addUserError } = await supabase_service
        .from("user_teams")
        .insert({
          user_id: userId,
          team_id: newTeam.id,
          role: "owner",
        });

      if (addUserError) {
        logger.error("Failed to add user to team", { error: addUserError });
        return res
          .status(500)
          .json({ success: false, error: "Failed to add user to team" });
      }

      // Create API key
      const apiKey = crypto.randomUUID();
      const { error: apiKeyError } = await supabase_service
        .from("api_keys")
        .insert({
          name: "Default",
          key: apiKey,
          team_id: newTeam.id,
          owner_id: userId,
        });

      if (apiKeyError) {
        logger.error("Failed to create API key", { error: apiKeyError });
        return res
          .status(500)
          .json({ success: false, error: "Failed to create API key" });
      }

      // Provision in Autumn
      try {
        await autumnService.ensureOrgProvisioned({
          orgId: newOrg.id,
          name: newOrg.name,
          email: email,
        });
        await autumnService.ensureTeamProvisioned({
          teamId: newTeam.id,
          orgId: newOrg.id,
          name: newTeam.name,
        });
      } catch (autumnError) {
        logger.error("Failed to provision Autumn", { error: autumnError });
        // Continue anyway, as Autumn provisioning is not critical for auth
      }

      logger.info("Successfully synced user to users table", {
        userId,
        teamId: newTeam.id,
      });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    logger.error("Error in Supabase auth webhook", { error });
    return res
      .status(500)
      .json({ success: false, error: "Internal server error" });
  }
}

/**
 * User signup endpoint
 * Creates a user in Supabase Auth and directly creates user/team/org records
 */
export async function signupController(req: Request, res: Response) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ success: false, error: "Email and password are required" });
    }

    // Create user in Supabase Auth
    const { data, error } = await supabase.auth.signUp({
      email: email.toLowerCase(),
      password,
    });

    if (error) {
      logger.error("Failed to signup user", { error });
      return res.status(400).json({ success: false, error: error.message });
    }

    if (!data.user) {
      return res
        .status(400)
        .json({ success: false, error: "Failed to create user" });
    }

    const userId = data.user.id;
    const userEmail = data.user.email;

    logger.info("User signed up successfully", { email: userEmail, userId });

    // Create organization first
    const { data: newOrg, error: orgError } = await supabase_service
      .from("organizations")
      .insert({ name: "pending" })
      .select()
      .single();

    if (orgError) {
      logger.error("Failed to create organization", { error: orgError });
      return res
        .status(500)
        .json({ success: false, error: "Failed to create organization" });
    }

    // Create team
    const { data: newTeam, error: teamError } = await supabase_service
      .from("teams")
      .insert({
        name: userEmail,
        created_by: userId,
        org_id: newOrg.id,
        plan_id: "free",
        credits: 0,
      })
      .select()
      .single();

    if (teamError) {
      logger.error("Failed to create team", { error: teamError });
      return res
        .status(500)
        .json({ success: false, error: "Failed to create team" });
    }

    // Update org name to match team ID
    await supabase_service
      .from("organizations")
      .update({ name: newTeam.id })
      .eq("id", newOrg.id);

    // Create user record in users table
    const { error: createUserError } = await supabase_service
      .from("users")
      .insert({
        id: userId,
        email: userEmail,
        team_id: newTeam.id,
      });

    if (createUserError) {
      logger.error("Failed to create user record", { error: createUserError });
      return res
        .status(500)
        .json({ success: false, error: "Failed to create user record" });
    }

    // Add user to user_teams
    const { error: addUserError } = await supabase_service
      .from("user_teams")
      .insert({
        user_id: userId,
        team_id: newTeam.id,
        role: "owner",
      });

    if (addUserError) {
      logger.error("Failed to add user to team", { error: addUserError });
      return res
        .status(500)
        .json({ success: false, error: "Failed to add user to team" });
    }

    // Create API key
    const apiKey = crypto.randomUUID();
    const { error: apiKeyError } = await supabase_service
      .from("api_keys")
      .insert({
        name: "Default",
        key: apiKey,
        team_id: newTeam.id,
        owner_id: userId,
      });

    if (apiKeyError) {
      logger.error("Failed to create API key", { error: apiKeyError });
      return res
        .status(500)
        .json({ success: false, error: "Failed to create API key" });
    }

    // Provision in Autumn
    try {
      await autumnService.ensureOrgProvisioned({
        orgId: newOrg.id,
        name: newOrg.name,
        email: userEmail,
      });
      await autumnService.ensureTeamProvisioned({
        teamId: newTeam.id,
        orgId: newOrg.id,
        name: newTeam.name,
      });
    } catch (autumnError) {
      logger.error("Failed to provision Autumn", { error: autumnError });
      // Continue anyway, as Autumn provisioning is not critical for auth
    }

    logger.info("User provisioning completed", { userId, teamId: newTeam.id });

    return res.status(201).json({
      success: true,
      message:
        "Signup successful. Please check your email to verify your account.",
      userId: data.user?.id,
    });
  } catch (error) {
    logger.error("Error in signup", { error });
    return res
      .status(500)
      .json({ success: false, error: "Internal server error" });
  }
}

/**
 * User login endpoint
 * Authenticates user and sets httpOnly cookie with session token
 */
export async function loginController(req: Request, res: Response) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ success: false, error: "Email and password are required" });
    }

    // Sign in with Supabase
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.toLowerCase(),
      password,
    });

    if (error) {
      logger.error("Failed to login user", { error });
      return res.status(401).json({ success: false, error: error.message });
    }

    const { session, user } = data;

    if (!session || !user) {
      return res.status(401).json({ success: false, error: "Login failed" });
    }

    // Set httpOnly cookie with session token
    res.cookie("session", session.access_token, {
      httpOnly: true,
      secure: config.IS_PRODUCTION,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: "/",
    });

    logger.info("User logged in successfully", { email, userId: user.id });

    return res.status(200).json({
      success: true,
      message: "Login successful",
      user: {
        id: user.id,
        email: user.email,
      },
    });
  } catch (error) {
    logger.error("Error in login", { error });
    return res
      .status(500)
      .json({ success: false, error: "Internal server error" });
  }
}

/**
 * User logout endpoint
 * Clears the session cookie and signs out from Supabase
 */
export async function logoutController(req: Request, res: Response) {
  try {
    const sessionToken = req.cookies.session;

    if (sessionToken) {
      // Sign out from Supabase
      await supabase.auth.signOut();
    }

    // Clear the cookie
    res.clearCookie("session", {
      httpOnly: true,
      secure: config.IS_PRODUCTION,
      sameSite: "lax",
      path: "/",
    });

    logger.info("User logged out successfully");

    return res.status(200).json({
      success: true,
      message: "Logout successful",
    });
  } catch (error) {
    logger.error("Error in logout", { error });
    return res
      .status(500)
      .json({ success: false, error: "Internal server error" });
  }
}

/**
 * Get current user endpoint
 * Returns the current authenticated user based on cookie
 */
export async function getCurrentUserController(req: Request, res: Response) {
  try {
    const sessionToken = req.cookies.session;

    if (!sessionToken) {
      return res
        .status(401)
        .json({ success: false, error: "Not authenticated" });
    }

    // Verify session with Supabase
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(sessionToken);

    if (error || !user) {
      return res.status(401).json({ success: false, error: "Invalid session" });
    }

    // Get user's team info
    const { data: userTeams, error: teamsError } = await supabase_service
      .from("user_teams")
      .select("team_id")
      .eq("user_id", user.id)
      .limit(1)
      .single();

    if (teamsError || !userTeams) {
      return res.status(200).json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
        },
      });
    }

    return res.status(200).json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        teamId: userTeams.team_id,
      },
    });
  } catch (error) {
    logger.error("Error in getCurrentUser", { error });
    return res
      .status(500)
      .json({ success: false, error: "Internal server error" });
  }
}
