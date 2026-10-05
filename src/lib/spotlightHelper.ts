import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import { PLATFORM_HELP_ITEMS } from '../config/platformHelp.ts';

export interface ShowHelpTargetParams {
  route?: string;
  helpId: string;
  leadId?: string;
  title?: string;
  message?: string;
  currentPath?: string;
  navigate?: (path: string) => void;
  closeCondo?: () => void;
}

export function showHelpTarget({
  route,
  helpId,
  leadId,
  title,
  message,
  currentPath,
  navigate,
  closeCondo,
}: ShowHelpTargetParams) {
  // 1. Close or minimize Condo drawer temporarily so it doesn't block the element
  if (closeCondo) {
    closeCondo();
  }

  // Find matching platform help item for contextual titles & descriptions
  const helpItem = PLATFORM_HELP_ITEMS.find((item) => item.target === helpId || item.id === helpId);
  const popoverTitle = title || helpItem?.highlightTitle || helpItem?.title || 'Ajuda Visual Triverus';
  const popoverDescription = message || helpItem?.highlightDescription || helpItem?.description || 'Clique neste controle para prosseguir.';

  // 2. Navigate client-side if target route is different
  const targetRoute = route || helpItem?.route || (helpId.includes('followup') ? '/app/followups' : '/app/pipeline');
  if (navigate && currentPath && currentPath !== targetRoute) {
    navigate(targetRoute);
  }

  // 3. Poll for element in DOM (up to 5 seconds)
  let attempts = 0;
  const maxAttempts = 50; // 50 * 100ms = 5 seconds

  const interval = setInterval(() => {
    attempts++;

    let targetEl: HTMLElement | null = null;

    if (leadId) {
      targetEl = document.querySelector(`[data-lead-id="${leadId}"] [data-help-id="${helpId}"]`) as HTMLElement | null;
    }

    if (!targetEl) {
      targetEl = document.querySelector(`[data-help-id="${helpId}"]`) as HTMLElement | null;
    }

    if (!targetEl) {
      targetEl = document.querySelector(`[data-help-target="${helpId}"]`) as HTMLElement | null;
    }

    if (targetEl) {
      clearInterval(interval);

      // Scroll into view smoothly
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });

      setTimeout(() => {
        try {
          const driverObj = driver({
            showProgress: false,
            animate: true,
            allowClose: true,
            overlayColor: '#09090b',
            overlayOpacity: 0.8,
            stagePadding: 8,
            stageRadius: 10,
            popoverClass: 'triverus-spotlight-popover',
            nextBtnText: 'Entendi',
            prevBtnText: 'Anterior',
            doneBtnText: 'Entendi',
            steps: [
              {
                element: targetEl,
                popover: {
                  title: popoverTitle,
                  description: popoverDescription,
                  side: 'top',
                  align: 'center',
                },
              },
            ],
          });

          driverObj.drive();
        } catch (err) {
          console.warn('Driver.js error, falling back to pulse highlight:', err);
          targetEl?.classList.add('ring-4', 'ring-[#FF6600]', 'scale-105', 'transition-all', 'duration-300');
          setTimeout(() => {
            targetEl?.classList.remove('ring-4', 'ring-[#FF6600]', 'scale-105');
          }, 3500);
        }
      }, 250);
    } else if (attempts >= maxAttempts) {
      clearInterval(interval);
      alert('Não consegui localizar esse controle na tela atual.');
    }
  }, 100);
}
