const fs = require('fs');
let content = fs.readFileSync('/home/ashish/edu/saa9vi_com/docs/adr/rfc-001-continuous-commerce-loop.md', 'utf-8');

const brokenText = 'via a custom field (e.g., ) or a dedicated';
const fixedText = 'via a custom field (e.g., `Order.customFields.orderType: \'subscription_renewal\' | \'storefront_checkout\'`) or a dedicated';

if (content.includes(brokenText)) {
  content = content.replace(brokenText, fixedText);
  fs.writeFileSync('/home/ashish/edu/saa9vi_com/docs/adr/rfc-001-continuous-commerce-loop.md', content, 'utf-8');
  console.log('Fixed.');
} else {
  console.log('broken text not found');
}

