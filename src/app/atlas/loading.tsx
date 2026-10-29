import { MapSkeleton, TableSkeleton, Shimmer } from "@/components/skeleton";
export default function Loading() { return <div className="flex flex-col gap-5" aria-busy><div><Shimmer className="h-2.5 w-20 mb-3" /><Shimmer className="h-8 w-64" /></div><MapSkeleton /><TableSkeleton rows={8} cols={7} /></div>; }
