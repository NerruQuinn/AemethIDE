import { useStore } from '@nanostores/react';
import { ClientOnly } from 'remix-utils/client-only';
import { chatStore } from '~/lib/stores/chat';
import { classNames } from '~/utils/classNames';
import { HeaderActionButtons } from './HeaderActionButtons.client';
import { ChatDescription } from '~/lib/persistence/ChatDescription.client';
import { sidebarStore, toggleSidebar } from '~/lib/stores/sidebar';
export function Header() {
  const chat = useStore(chatStore);
  const isMenuOpen = useStore(sidebarStore);
  return (
    <header
      className={classNames('flex items-center gap-1 sm:gap-2 px-3 sm:px-5 border-b h-[var(--header-height)]', {
        'border-transparent': !chat.started,
        'border-bolt-elements-borderColor': chat.started,
      })}
    >
      <button
        type="button"
        onClick={toggleSidebar}
        aria-label={isMenuOpen ? 'Close chat history menu' : 'Open chat history menu'}
        aria-expanded={isMenuOpen}
        className={classNames(
          'flex items-center justify-center shrink-0 w-8 h-8 -ml-1.5 rounded-lg transition-colors',
          isMenuOpen
            ? 'text-bolt-elements-item-contentAccent bg-bolt-elements-item-backgroundAccent'
            : 'text-bolt-elements-item-contentActive bg-transparent hover:bg-bolt-elements-item-backgroundActive',
        )}
      >
        <div className={classNames('text-xl', isMenuOpen ? 'i-ph:sidebar-simple-fill' : 'i-ph:sidebar-simple')} />
      </button>
      <a
        href="/"
        aria-label="Aemeth"
        className="flex items-center select-none group shrink-0"
        style={{ fontFamily: "'Cinzel', Georgia, 'Times New Roman', serif" }}
      >
        <span className="text-[22px] sm:text-[26px] leading-none font-bold tracking-[0.14em] bg-gradient-to-br from-accent-300 via-accent-400 to-accent-500 bg-clip-text text-transparent group-hover:opacity-80 transition-opacity">
          Aemeth
        </span>
      </a>
      {chat.started && ( // Display ChatDescription and HeaderActionButtons only when the chat has started.
        <>
          <span className="flex-1 min-w-0 px-2 sm:px-4 truncate text-center text-bolt-elements-textPrimary">
            <ClientOnly>{() => <ChatDescription />}</ClientOnly>
          </span>
          <ClientOnly>
            {() => (
              <div className="ml-auto shrink-0">
                <HeaderActionButtons />
              </div>
            )}
          </ClientOnly>
        </>
      )}
    </header>
  );
}
