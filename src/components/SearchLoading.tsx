export function SearchLoading() {
  return (
    <div className="py-12 flex flex-col items-center justify-center gap-6 animate-fade-in">
      <div className="relative">
        <div className="w-14 h-14 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
        </div>
      </div>
      <div className="text-center space-y-1">
        <p className="text-foreground font-medium flex items-center justify-center gap-1">
          Searching
          <span className="inline-flex gap-0.5 ml-0.5">
            <span className="w-1 h-1 rounded-full bg-primary animate-[search-pulse_1s_ease-in-out_infinite]" />
            <span className="w-1 h-1 rounded-full bg-primary animate-[search-pulse_1s_ease-in-out_0.2s_infinite]" />
            <span className="w-1 h-1 rounded-full bg-primary animate-[search-pulse_1s_ease-in-out_0.4s_infinite]" />
          </span>
        </p>
        <p className="text-muted-foreground text-sm">the community-indexed web</p>
      </div>
    </div>
  );
}
