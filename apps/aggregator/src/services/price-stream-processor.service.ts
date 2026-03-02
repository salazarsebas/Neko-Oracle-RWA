import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { RawPrice } from '@oracle-stocks/shared';
import { PriceInputDto } from '../dto/price-input.dto';
import {
  NormalizedPrice,
  NormalizedPriceRecord,
} from '../interfaces/normalized-price.interface';
import { NormalizationService } from './normalization.service';
import { AggregationService } from './aggregation.service';
import { DebugService } from '../debug/debug.service';

@Injectable()
export class PriceStreamProcessorService {
  private readonly logger = new Logger(PriceStreamProcessorService.name);
  private readonly priceBuffer = new Map<string, NormalizedPrice[]>();
  private readonly timeWindowMs: number;
  private readonly minSources: number;

  constructor(
    private readonly normalizationService: NormalizationService,
    private readonly aggregationService: AggregationService,
    private readonly debugService: DebugService,
    private readonly configService: ConfigService,
  ) {
    this.timeWindowMs = this.configService.get<number>(
      'AGG_TIME_WINDOW_MS',
      30000,
    );
    this.minSources = this.configService.get<number>('AGG_MIN_SOURCES', 3);
  }

  @OnEvent('price.received')
  handlePriceReceived(dto: PriceInputDto): void {
    // Step 1: Convert DTO → RawPrice
    const rawPrice = this.toRawPrice(dto);

    // Step 2: Normalize
    let record: NormalizedPriceRecord;
    try {
      record = this.normalizationService.normalize(rawPrice);
    } catch (error) {
      this.logger.warn(
        `Normalization failed for ${dto.symbol} from ${dto.source}: ${(error as Error).message}`,
      );
      return;
    }

    // Step 3: Convert NormalizedPriceRecord → NormalizedPrice
    const normalizedPrice = this.toNormalizedPrice(record);

    // Step 4: Buffer, dedup, and prune
    this.addToBuffer(normalizedPrice);

    // Step 5: Update debug store with current buffer
    const buffer = this.priceBuffer.get(normalizedPrice.symbol) ?? [];
    this.debugService.setLastNormalized(normalizedPrice.symbol, [...buffer]);

    // Step 6: Try aggregation
    this.tryAggregate(normalizedPrice.symbol);
  }

  private toRawPrice(dto: PriceInputDto): RawPrice {
    return {
      symbol: dto.symbol,
      price: dto.price,
      source: dto.source,
      timestamp: new Date(dto.timestamp).getTime(),
    };
  }

  private toNormalizedPrice(record: NormalizedPriceRecord): NormalizedPrice {
    return {
      symbol: record.symbol,
      price: record.price,
      timestamp: record.originalTimestamp,
      source: record.source as string,
    };
  }

  private addToBuffer(price: NormalizedPrice): void {
    let buffer = this.priceBuffer.get(price.symbol);
    if (!buffer) {
      buffer = [];
      this.priceBuffer.set(price.symbol, buffer);
    }

    // Dedup: replace any existing entry from the same source
    const existingIndex = buffer.findIndex((p) => p.source === price.source);
    if (existingIndex !== -1) {
      buffer[existingIndex] = price;
    } else {
      buffer.push(price);
    }

    // Prune: remove entries outside the time window
    const cutoff = Date.now() - this.timeWindowMs;
    const pruned = buffer.filter((p) => p.timestamp >= cutoff);
    this.priceBuffer.set(price.symbol, pruned);
  }

  private tryAggregate(symbol: string): void {
    const buffer = this.priceBuffer.get(symbol) ?? [];
    const distinctSources = new Set(buffer.map((p) => p.source)).size;

    if (distinctSources < this.minSources) {
      return;
    }

    try {
      this.aggregationService.aggregate(symbol, [...buffer], {
        minSources: this.minSources,
        timeWindowMs: this.timeWindowMs,
      });
    } catch (error) {
      this.logger.warn(
        `Aggregation failed for ${symbol}: ${(error as Error).message}`,
      );
    }
  }
}
