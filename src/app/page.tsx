import { redirect } from "next/navigation";
import { getCurrentActor } from "@/server/auth/session";

export default async function Home() {
  redirect((await getCurrentActor()) ? "/dashboard" : "/login");
}
