/** Route-segment fallback: something moves the moment a navigation starts. */
export default function Loading() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-foreground/20 border-t-foreground" />
    </div>
  );
}
