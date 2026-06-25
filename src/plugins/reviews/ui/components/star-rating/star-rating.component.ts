// src/plugins/reviews/ui/components/star-rating/star-rating.component.ts
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { FormControl } from '@angular/forms';
import { CustomFieldConfigType, CustomFieldControl, SharedModule } from '@vendure/admin-ui/core';

type StarType = 'empty' | 'full' | 'half';

@Component({
    selector: 'star-rating',
    templateUrl: './star-rating.component.html',
    styleUrls: ['./star-rating.component.scss'],
    changeDetection: ChangeDetectionStrategy.Default,
    standalone: true,
    imports: [SharedModule],
})
export class StarRatingComponent implements CustomFieldControl {
    @Input() rating: number | null;
    @Input() showLabel = false;

    readonly: boolean;
    config: CustomFieldConfigType;
    formControl: FormControl;

    /**
     * Returns the current star rating. If a formControl is present, its value is used.
     * Otherwise, the 'rating' input is used. If 'rating' is null, it defaults to 0
     * to ensure a number is always returned, satisfying the TypeScript type.
     */
    get starRating(): number {
        // Use the formControl value if available, otherwise use the input 'rating'.
        // If 'rating' is null, default to 0 to prevent type errors.
        return this.formControl ? this.formControl.value : (this.rating ?? 0);
    }

    get stars(): StarType[] {
        const rating = this.starRating; // This will now always be a number
        return Array.from({ length: 5 }).map((_, i) => {
            const pos = i + 1;
            const filled = rating >= pos;
            if (filled) {
                return 'full';
            }
            if (Math.ceil(rating) < pos) {
                return 'empty';
            }
            return 'half';
        });
    }
}
