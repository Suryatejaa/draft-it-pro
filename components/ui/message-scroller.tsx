'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ArrowDownIcon } from 'lucide-react';

interface MessageScrollerContextValue {
  atBottom: boolean;
  scrollToBottom: () => void;
  scrollable: boolean;
}

const MessageScrollerContext = React.createContext<MessageScrollerContextValue>({
  atBottom: true,
  scrollToBottom: () => {},
  scrollable: false,
});

function useMessageScroller() {
  return React.useContext(MessageScrollerContext);
}

function useMessageScrollerScrollable() {
  return React.useContext(MessageScrollerContext).scrollable;
}

function useMessageScrollerVisibility() {
  return !React.useContext(MessageScrollerContext).atBottom;
}

function MessageScrollerProvider({ children }: { children: React.ReactNode }) {
  const [atBottom, setAtBottom] = React.useState(true);
  const [scrollable, setScrollable] = React.useState(false);
  const viewportRef = React.useRef<HTMLDivElement>(null);

  const scrollToBottom = React.useCallback(() => {
    viewportRef.current?.scrollTo({ top: viewportRef.current.scrollHeight, behavior: 'smooth' });
  }, []);

  const handleScroll = React.useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
    setScrollable(el.scrollHeight > el.clientHeight);
  }, []);

  return (
    <MessageScrollerContext.Provider value={{ atBottom, scrollToBottom, scrollable }}>
      {React.cloneElement(
        children as React.ReactElement<{ ref?: React.Ref<HTMLDivElement>; onScroll?: React.UIEventHandler }>,
        { ref: viewportRef, onScroll: handleScroll },
      )}
    </MessageScrollerContext.Provider>
  );
}

function MessageScroller({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="message-scroller"
      className={cn('group/message-scroller relative flex size-full min-h-0 flex-col overflow-hidden', className)}
      {...props}
    >
      {children}
    </div>
  );
}

function MessageScrollerViewport({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="message-scroller-viewport"
      className={cn('size-full min-h-0 min-w-0 overflow-y-auto overscroll-contain', className)}
      {...props}
    />
  );
}

function MessageScrollerContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="message-scroller-content"
      className={cn('gap-6 flex h-max min-h-full flex-col', className)}
      {...props}
    />
  );
}

function MessageScrollerItem({
  className,
  scrollAnchor: _scrollAnchor,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { scrollAnchor?: boolean }) {
  return (
    <div
      data-slot="message-scroller-item"
      className={cn('min-w-0 shrink-0', className)}
      {...props}
    />
  );
}

function MessageScrollerButton({
  direction = 'end',
  className,
  children,
  variant = 'secondary',
  size = 'icon-sm',
  ...props
}: React.HTMLAttributes<HTMLButtonElement> & {
  direction?: 'start' | 'end';
  variant?: 'secondary' | 'default' | 'outline' | 'ghost' | 'link' | 'destructive';
  size?: 'icon-sm' | 'sm' | 'default' | 'lg' | 'icon';
}) {
  const { atBottom, scrollToBottom } = useMessageScroller();
  const active = !atBottom;
  return (
    <Button
      data-slot="message-scroller-button"
      data-direction={direction}
      data-active={active}
      variant={variant}
      size={size}
      onClick={scrollToBottom}
      className={cn(
        'absolute inset-x-1/2 -translate-x-1/2 transition-[translate,scale,opacity] duration-200',
        direction === 'end' ? 'bottom-4' : 'top-4',
        !active && 'pointer-events-none scale-95 opacity-0',
        className,
      )}
      {...(props as React.ComponentProps<typeof Button>)}
    >
      {children ?? (
        <>
          <ArrowDownIcon />
          <span className="sr-only">{direction === 'end' ? 'Scroll to end' : 'Scroll to start'}</span>
        </>
      )}
    </Button>
  );
}

export {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
};
