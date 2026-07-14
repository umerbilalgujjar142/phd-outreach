import { Body, Controller, Param, Post } from '@nestjs/common';
import { PersonalizationService } from './personalization.service';

@Controller('personalization')
export class PersonalizationController {
  constructor(private readonly personalization: PersonalizationService) {}

  /** Personalize a batch that still needs a snippet. Body: { limit?, force? }. */
  @Post('run')
  run(@Body() body: { limit?: number; force?: boolean } = {}) {
    return this.personalization.personalizePending(body.limit, body.force);
  }

  /** Personalize (or force-regenerate) a single professor by id. */
  @Post(':id')
  one(@Param('id') id: string, @Body() body: { force?: boolean } = {}) {
    return this.personalization.personalizeOne(id, body.force);
  }
}
