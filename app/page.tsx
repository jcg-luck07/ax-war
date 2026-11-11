import { redirect } from 'next/navigation'

// 첫 화면은 할 일이에요.
export default function Home() {
  redirect('/inbox')
}
