import { redirect } from 'next/navigation';

// Root → clinic login (the portal has no public landing page).
export default function Home() {
  redirect('/clinic/login');
}
