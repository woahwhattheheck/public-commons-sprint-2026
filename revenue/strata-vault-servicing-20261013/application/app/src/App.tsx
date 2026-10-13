// Modified 2026-10-13: add the optional servicing history route and navigation.
import { NavLink, Outlet, Route, Routes } from "react-router-dom"
import styles from "./App.module.css"
import ConnectAccount from "./components/ConnectAccount"
import ExternalLink from "./components/icons/ExternalLink"
import AdminPanel from "./pages/AdminPanel"
import VaultPreview from "./pages/VaultPreview"
import ServicingHistory from "./pages/ServicingHistory"

function App() {
	return (
		<Routes>
			<Route element={<AppLayout />}>
				<Route path="/" element={<VaultPreview />} />
				<Route path="/admin" element={<AdminPanel />} />
				<Route path="/history" element={<ServicingHistory />} />
			</Route>
		</Routes>
	)
}

const AppLayout = () => (
	<div className={styles.AppLayout}>
		<header className={styles.header}>
			<span className={styles.logo}>Strata Vault Kit</span>
			<nav className={styles.primaryNav} aria-label="Vault pages">
				<NavLink to="/" end>Vault</NavLink>
				<NavLink to="/history">History and statements</NavLink>
				<NavLink to="/admin">Administration</NavLink>
			</nav>
			<ConnectAccount />
		</header>

		<main className={styles.main}>
			<Outlet />
		</main>

		<footer className={styles.footer}>
			<nav className={styles.footerNav}>
				<a
					href="https://github.com/BootNodeDev/strata-vault-kit"
					target="_blank"
					rel="noreferrer"
				>
					GitHub
					<ExternalLink className={styles.linkIcon} />
				</a>
			</nav>
		</footer>
	</div>
)

export default App
