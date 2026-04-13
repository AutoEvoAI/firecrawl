import { Request, Response } from "express";
import { createClient } from "@supabase/supabase-js";
import { config } from "../../config";
import { DashboardAuthRequest } from "../../lib/dashboard-auth";
import {
  getTeamBalance,
  getTeamHistoricalUsage,
} from "../../services/autumn/usage";

const supabase = createClient(
  config.SUPABASE_URL || "",
  config.SUPABASE_SERVICE_TOKEN || "",
);

export async function getCreditUsage(req: DashboardAuthRequest, res: Response) {
  try {
    const { teamId } = req.auth!;
    console.log("[Credit Usage] Fetching credit usage for teamId:", teamId);

    let remainingCredits: number | null = null;
    let totalCreditsSum: number | null = null;
    let dataSource = "autumn";
    let error: string | null = null;

    // Try to get balance from Autumn, fall back to local data if it fails
    try {
      console.log(
        "[Credit Usage] Attempting to fetch balance from Autumn for teamId:",
        teamId,
      );
      const balance = await getTeamBalance(teamId);
      console.log(
        "[Credit Usage] Autumn balance response:",
        JSON.stringify(balance, null, 2),
      );

      if (balance) {
        remainingCredits = balance.remaining;
        totalCreditsSum = balance.granted;
        console.log(
          "[Credit Usage] Successfully fetched from Autumn - remaining:",
          remainingCredits,
          "granted:",
          totalCreditsSum,
        );
      } else {
        error = "No balance data from Autumn";
        dataSource = "error";
        console.warn(
          "[Credit Usage] Autumn returned null balance for teamId:",
          teamId,
        );
      }
    } catch (autumnError: any) {
      console.error(
        "[Credit Usage] Autumn balance fetch failed for teamId:",
        teamId,
      );
      console.error("[Credit Usage] Error details:", {
        message: autumnError.message,
        stack: autumnError.stack,
        statusCode: autumnError.statusCode,
        status: autumnError.status,
        response: autumnError.response?.data,
      });
      error = autumnError.message;
      dataSource = "error";

      // Try database fallback
      try {
        console.log(
          "[Credit Usage] Attempting database fallback for teamId:",
          teamId,
        );
        const { data: team, error: dbError } = await supabase
          .from("teams")
          .select("credits, org_id")
          .eq("id", teamId)
          .single();

        console.log("[Credit Usage] Database query result:", {
          data: team,
          error: dbError,
        });

        if (team) {
          remainingCredits = team.credits;
          totalCreditsSum = team.credits;
          dataSource = "database";
          console.log(
            "[Credit Usage] Successfully fetched from database - credits:",
            team.credits,
            "org_id:",
            team.org_id,
          );
        }
      } catch (dbError: any) {
        console.error("[Credit Usage] Database fallback failed:", dbError);
        error = "Failed to fetch from both Autumn and database";
        dataSource = "error";
      }
    }

    // Get team configuration for concurrency and rate limits
    const { data: team } = await supabase
      .from("teams")
      .select("plan_id, org_id")
      .eq("id", teamId)
      .single();

    // Get plan configuration
    let concurrency = 2;
    let rateLimits = { scrape: 0, crawl: 0, extract: 0 };

    if (team) {
      console.log("[Credit Usage] Team data:", {
        team_id: teamId,
        plan_id: team.plan_id,
        org_id: team.org_id,
      });

      // First check organization_overrides
      const { data: orgOverride, error: orgOverrideError } = await supabase
        .from("organization_overrides")
        .select("max_concurrent_requests")
        .eq("organization_id", team.org_id)
        .single();

      console.log("[Credit Usage] Organization override query:", {
        data: orgOverride,
        error: orgOverrideError,
      });

      if (orgOverride?.max_concurrent_requests) {
        concurrency = orgOverride.max_concurrent_requests;
        console.log(
          "[Credit Usage] Using organization override concurrency:",
          concurrency,
        );
      } else if (team?.plan_id) {
        // Fall back to plan_configs
        const { data: planConfig, error: planConfigError } = await supabase
          .from("plan_configs")
          .select("max_concurrent_requests, rate_limits")
          .eq("id", team.plan_id)
          .single();

        console.log("[Credit Usage] Plan config query:", {
          data: planConfig,
          error: planConfigError,
        });

        if (planConfig) {
          concurrency = planConfig.max_concurrent_requests || 2;
          rateLimits = planConfig.rate_limits || {
            scrape: 0,
            crawl: 0,
            extract: 0,
          };
          console.log(
            "[Credit Usage] Using plan config concurrency:",
            concurrency,
          );
        }
      }
    }

    res.json({
      remaining_credits: remainingCredits,
      total_credits_sum: totalCreditsSum,
      concurrency,
      rate_limits: rateLimits,
      data_source: dataSource,
      error: error,
    });
  } catch (error) {
    console.error("Get credit usage error:", error);
    res.status(500).json({ error: "Failed to fetch credit usage" });
  }
}

export async function getCreditUsageHistorical(
  req: DashboardAuthRequest,
  res: Response,
) {
  try {
    const { teamId } = req.auth!;
    const periods = await getTeamHistoricalUsage(teamId);

    // Sort by date
    periods.sort((a, b) => {
      const aTime = a.startDate ? Date.parse(a.startDate) : NaN;
      const bTime = b.startDate ? Date.parse(b.startDate) : NaN;
      const aNaN = Number.isNaN(aTime);
      const bNaN = Number.isNaN(bTime);
      if (aNaN && bNaN) return 0;
      if (aNaN) return 1;
      if (bNaN) return -1;
      return aTime - bTime;
    });

    // Transform to match frontend expectations
    const data = periods.map((period: any) => ({
      date: period.startDate || period.endDate,
      credits: period.creditsUsed,
    }));

    res.json({ data });
  } catch (error) {
    console.error("Get historical credit usage error:", error);
    res.status(500).json({ error: "Failed to fetch historical credit usage" });
  }
}
