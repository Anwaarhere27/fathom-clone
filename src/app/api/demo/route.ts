import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

/**
 * "Try the demo": signs the visitor in anonymously and gives them their own
 * copy of the seeded workspace.
 *
 * A shared demo account would mean two people opening the live link at the
 * same time edit the same rows -- one of them marks an action item done and
 * the other watches it happen. Cloning per visitor costs one function call.
 */
export async function POST() {
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.user) {
    return NextResponse.json(
      { error: error?.message ?? "Could not start a demo session." },
      { status: 500 }
    );
  }

  // Cloning reads the template user's rows, which the visitor cannot see under
  // RLS, so it runs with the service role.
  const admin = createAdminClient();
  const { error: cloneError } = await admin.rpc("clone_demo_workspace", {
    target_user: data.user.id,
  });

  // Before the seed has been loaded there is nothing to clone. Let the visitor
  // in anyway rather than dead-ending them on an empty workspace.
  if (cloneError && !/demo template not seeded/i.test(cloneError.message)) {
    return NextResponse.json({ error: cloneError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
