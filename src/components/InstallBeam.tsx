import { Download } from 'lucide-react'
import { useEffect, useState } from 'react'

type InstallPromptEvent = Event & {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isIosSafari() {
  const userAgent = navigator.userAgent
  return /iPad|iPhone|iPod/.test(userAgent) && !/CriOS|FxiOS|EdgiOS/.test(userAgent)
}

export function InstallBeam() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(() => window.matchMedia('(display-mode: standalone)').matches)
  const [ios, setIos] = useState(false)

  useEffect(() => {
    setIos(isIosSafari())
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as InstallPromptEvent)
    }
    const onAppInstalled = () => {
      setInstalled(true)
      setInstallPrompt(null)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onAppInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onAppInstalled)
    }
  }, [])

  const install = async () => {
    if (!installPrompt) return
    await installPrompt.prompt()
    const choice = await installPrompt.userChoice
    if (choice.outcome === 'accepted') setInstalled(true)
    setInstallPrompt(null)
  }

  if (installed) return null
  if (installPrompt) return <aside className="install-beam" aria-label="Install Beam">
    <div><strong>Keep Beam close</strong><span>Install for a cleaner, full-screen sharing space.</span></div>
    <button type="button" onClick={() => void install()}><Download size={17} aria-hidden="true" />Install</button>
  </aside>
  if (ios) return <p className="install-beam__ios">To install Beam on iPhone or iPad, use Safari’s Share menu, then choose <strong>Add to Home Screen</strong>.</p>
  return null
}
