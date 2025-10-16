// This function ensures that specific users always have premium access
// It's called when a user logs in or when checking premium status

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

Deno.serve(async (req: Request) => {
  // Handle CORS preflight request
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  try {
    // Get the request body
    const { email } = await req.json();
    
    if (!email) {
      return new Response(
        JSON.stringify({ error: "Email is required" }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        }
      );
    }
    
    // Create Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Supabase credentials not available");
    }
    
    // Create Supabase client
    const supabaseAdmin = createClient(supabaseUrl, supabaseKey);
    
    // Get user by email
    const { data: users, error: userError } = await supabaseAdmin
      .from('auth.users')
      .select('id')
      .eq('email', email.toLowerCase())
      .limit(1);
    
    if (userError || !users || users.length === 0) {
      return new Response(
        JSON.stringify({ error: "User not found" }),
        {
          status: 404,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        }
      );
    }
    
    const userId = users[0].id;
    
    // Check if user already has an active subscription
    const { data: existingSubscriptions } = await supabaseAdmin
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .limit(1);
    
    if (existingSubscriptions && existingSubscriptions.length > 0) {
      // User already has an active subscription, no need to create a new one
      return new Response(
        JSON.stringify({ 
          message: "User already has premium access",
          subscription: existingSubscriptions[0]
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        }
      );
    }
    
    // Create a new subscription for the user
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    
    const { data: newSubscription, error: subscriptionError } = await supabaseAdmin
      .from('subscriptions')
      .insert({
        user_id: userId,
        status: 'active',
        quantity: 1,
        cancel_at_period_end: false,
        current_period_start: new Date().toISOString(),
        current_period_end: thirtyDaysFromNow.toISOString() // 30 days from now
      })
      .select()
      .single();
    
    if (subscriptionError) {
      throw subscriptionError;
    }
    
    return new Response(
      JSON.stringify({ 
        message: "Premium access granted successfully",
        subscription: newSubscription
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  } catch (error) {
    console.error("Error in sync-user-premium function:", error);
    
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  }
});

// Helper function to create Supabase client
import { createClient } from "npm:@supabase/supabase-js@2.39.0";