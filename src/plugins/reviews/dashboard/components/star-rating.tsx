import { StarIcon } from 'lucide-react';

export function StarRating({ rating }: { rating?: number | null }) {
    const value = Math.max(0, Math.min(5, Math.round(rating ?? 0)));
    return (
        <div className="flex items-center gap-1" aria-label={`${rating ?? 0} out of 5 stars`}>
            {Array.from({ length: 5 }).map((_, index) => (
                <StarIcon
                    key={index}
                    className={`h-4 w-4 ${index < value ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground'}`}
                />
            ))}
            <span className="ml-1 text-sm text-muted-foreground">{rating ?? 0}</span>
        </div>
    );
}